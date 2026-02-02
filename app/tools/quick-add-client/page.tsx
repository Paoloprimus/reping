'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useCrypto } from '@/lib/crypto/CryptoProvider';
import { useDrawers, LeftDrawer, RightDrawer } from '@/components/Drawers';
import TopBar from '@/components/home/TopBar';
import { supabase } from '@/lib/supabase/client';
import { geocodeAddress } from '@/lib/geocoding';

// Tipi di locali HoReCa predefiniti
const TIPO_LOCALE = [
  'Bar',
  'Ristorante',
  'Pizzeria',
  'Ristorante/Pizzeria',
  'Trattoria',
  'Chiosco',
  'Pub',
  'Pasticceria',
  'Gelateria',
  'Hotel',
  'Altro'
];

type ClientForm = {
  nomeCliente: string;
  piva: string;
  citta: string;
  indirizzo: string;
  tipoLocale: string;
  nomeContatto: string;
  telefono: string;
  email: string;
  note: string;
};

type DialogState = {
  active: boolean;
  currentField: keyof ClientForm | null;
  pendingValue: string;
  awaitingConfirmation: boolean;
};

function QuickAddClientContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { crypto, ready } = useCrypto();
  
  // Drawer
  const { leftOpen, rightOpen, rightContent, openLeft, closeLeft, openDati, openDocs, openImpostazioni, closeRight } = useDrawers();
  
  // 🆕 Flag per avviare dialogo vocale automaticamente
  const [autoVoiceTriggered, setAutoVoiceTriggered] = useState(false);

  // Logout
  async function logout() {
    try { sessionStorage.removeItem("repping:pph"); } catch {}
    try { localStorage.removeItem("repping:pph"); } catch {}
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  // 🔧 FIX: Usa `ready` dal context come fonte di verità
  // Il CryptoProvider gestisce già l'auto-unlock e il polling di isUnlocked()
  // Se ready è false ma il servizio è sbloccato, forziamo un re-check
  const [localReady, setLocalReady] = useState(false);
  
  useEffect(() => {
    // Se il context dice ready, siamo a posto
    if (ready) {
      setLocalReady(true);
      return;
    }
    
    // Polling per verificare se il servizio è stato sbloccato
    let cancelled = false;
    const interval = setInterval(() => {
      if (cancelled) return;
      
      try {
        const unlocked = crypto && typeof crypto.isUnlocked === 'function' && crypto.isUnlocked();
        if (unlocked) {
          console.log('[QuickAdd] ✅ Crypto unlocked detected via polling');
          setLocalReady(true);
          clearInterval(interval);
      }
      } catch {
        // ignore
      }
    }, 200);
    
    // Prova anche unlock da storage (sessionStorage O localStorage)
    const tryUnlock = async () => {
      if (!crypto || typeof crypto.unlockWithPassphrase !== 'function') return;
      
      const pass = sessionStorage.getItem('repping:pph') || localStorage.getItem('repping:pph');
      if (pass) {
        console.log('[QuickAdd] 🔧 Tento unlock da storage...');
          try {
            await crypto.unlockWithPassphrase(pass);
          console.log('[QuickAdd] ✅ Unlock completato!');
          setLocalReady(true);
          } catch (e) {
          console.error('[QuickAdd] ❌ Unlock fallito:', e);
          }
      }
    };
    
    tryUnlock();
    
    // Timeout dopo 5 secondi
    const timeout = setTimeout(() => {
      clearInterval(interval);
    }, 5000);
    
    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [crypto, ready]);

  const actuallyReady = ready || localReady;

  // 🆕 Auto-avvia dialogo vocale se richiesto via URL param
  useEffect(() => {
    if (autoVoiceTriggered) return;
    if (!actuallyReady) return;
    
    const voiceParam = searchParams.get('voice');
    if (voiceParam === '1') {
      setAutoVoiceTriggered(true);
      // Piccolo delay per assicurarsi che il component sia montato
      setTimeout(() => {
        startDialog();
      }, 500);
    }
  }, [actuallyReady, searchParams, autoVoiceTriggered]);

  // Dati del form
  const [form, setForm] = useState<ClientForm>({
    nomeCliente: '',
    piva: '',
    citta: '',
    indirizzo: '',
    tipoLocale: '',
    nomeContatto: '',
    telefono: '',
    email: '',
    note: '',
  });

  // Stato salvataggio
  const [saving, setSaving] = useState(false);
  const [resultMsg, setResultMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Stato dialogo vocale
  const [dialogState, setDialogState] = useState<DialogState>({
    active: false,
    currentField: null,
    pendingValue: '',
    awaitingConfirmation: false,
  });

  // TTS e riconoscimento vocale
  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis;
    }
  }, []);

  // Funzione per far parlare l'app
  function speak(text: string) {
    if (!synthRef.current) return;
    
    synthRef.current.cancel(); // ferma qualsiasi speech precedente
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'it-IT';
    utterance.rate = 0.95;
    utterance.pitch = 1.02;
    
    synthRef.current.speak(utterance);
  }

  // Aggiorna un campo del form
  function updateField(field: keyof ClientForm, value: string) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  // Ordine dei campi per il dialogo vocale
  const fieldOrder: Array<{ key: keyof ClientForm; label: string; optional: boolean }> = [
    { key: 'nomeCliente', label: 'nome del cliente', optional: false },
    { key: 'citta', label: 'città', optional: false },
    { key: 'indirizzo', label: 'indirizzo completo con numero civico', optional: false },
    { key: 'tipoLocale', label: 'tipo di locale', optional: false },
    { key: 'nomeContatto', label: 'nome del contatto', optional: false },
    { key: 'telefono', label: 'numero di telefono', optional: false },
    { key: 'email', label: 'email', optional: true },
    { key: 'piva', label: 'partita IVA', optional: true },
    { key: 'note', label: 'note aggiuntive', optional: true },
  ];

  // Avvia il dialogo vocale
  function startDialog() {
    if (typeof window === 'undefined') return;
    
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMsg('Il riconoscimento vocale non è supportato su questo browser. Usa Chrome.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'it-IT';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognitionRef.current = recognition;

    // Avvia con il primo campo
    setDialogState({
      active: true,
      currentField: fieldOrder[0].key,
      pendingValue: '',
      awaitingConfirmation: false,
    });

    askCurrentField(fieldOrder[0]);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript.trim();
      handleVoiceInput(transcript);
    };

    recognition.onerror = (event: any) => {
      console.error('Errore riconoscimento vocale:', event.error);
      setErrorMsg('Errore nel riconoscimento vocale. Riprova.');
      stopDialog();
    };

    recognition.start();
  }

  // Ferma il dialogo vocale
  function stopDialog() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error('Errore stop recognition:', e);
      }
      recognitionRef.current = null;
    }

    if (synthRef.current) {
      synthRef.current.cancel();
    }

    setDialogState({
      active: false,
      currentField: null,
      pendingValue: '',
      awaitingConfirmation: false,
    });
  }

  // Chiede il campo corrente
  function askCurrentField(field: { key: keyof ClientForm; label: string; optional: boolean }) {
    const question = field.optional 
      ? `Qual è ${field.label}? Puoi dire "salta" se non vuoi inserirlo.`
      : `Qual è ${field.label}?`;
    
    speak(question);
  }

  // Mappatura tipo locale dal riconoscimento vocale
  function mapTipoLocale(input: string): string {
    const lower = input.toLowerCase().trim();
    
    // Mappatura intelligente
    if (/\b(bar|caffè|café)\b/i.test(lower)) return 'Bar';
    if (/\bpizzeria\b/i.test(lower) && /\bristorante\b/i.test(lower)) return 'Ristorante/Pizzeria';
    if (/\bpizzeria\b/i.test(lower)) return 'Pizzeria';
    if (/\b(ristorante|trattoria)\b/i.test(lower)) return 'Ristorante';
    if (/\btrattoria\b/i.test(lower)) return 'Trattoria';
    if (/\b(chiosco|edicola)\b/i.test(lower)) return 'Chiosco';
    if (/\bpub\b/i.test(lower)) return 'Pub';
    if (/\bpasticceria\b/i.test(lower)) return 'Pasticceria';
    if (/\bgelateria\b/i.test(lower)) return 'Gelateria';
    if (/\bhotel\b/i.test(lower)) return 'Hotel';
    
    return 'Altro';
  }

  // Gestisce l'input vocale
  function handleVoiceInput(transcript: string) {
    const lower = transcript.toLowerCase();

    // Se stiamo aspettando conferma
    if (dialogState.awaitingConfirmation) {
      if (/\b(s[ìi]|esatto|ok|corretto|giusto|confermo)\b/i.test(lower)) {
        // Confermato!
        
        // Se siamo alla conferma finale (nessun campo corrente), salva
        if (dialogState.currentField === null) {
          stopDialog();
          saveClient();
          return;
        }
        
        // Altrimenti trascrivi e passa al prossimo
        confirmAndNext();
      } else if (/\b(no|sbagliato|errato|riprova)\b/i.test(lower)) {
        // Non confermato
        
        // Se eravamo alla conferma finale, riprendi dal primo campo opzionale
        if (dialogState.currentField === null) {
          speak('Va bene, ricontrolla i dati e dimmi quando sei pronto a salvare.');
          stopDialog();
          return;
        }
        
        // Altrimenti richiedi il campo
        speak('Va bene, riproviamo.');
        setTimeout(() => {
          const currentFieldInfo = fieldOrder.find(f => f.key === dialogState.currentField);
          if (currentFieldInfo) {
            askCurrentField(currentFieldInfo);
            startListening();
          }
        }, 1500);
      } else {
        // Ha detto qualcos'altro, interpretiamolo come nuovo valore
        setDialogState(prev => ({
          ...prev,
          pendingValue: transcript,
        }));
        speak(`Ho capito: ${transcript}. È giusto?`);
        startListening();
      }
      return;
    }

    // Se dice "salta" su campo opzionale
    const currentFieldInfo = fieldOrder.find(f => f.key === dialogState.currentField);
    if (currentFieldInfo?.optional && /\b(salta|skip)\b/i.test(lower)) {
      goToNextField();
      return;
    }

    // Altrimenti è la risposta al campo
    let valueToConfirm = transcript;
    
    // Applica mappatura per tipo locale
    if (dialogState.currentField === 'tipoLocale') {
      valueToConfirm = mapTipoLocale(transcript);
    }
    
    setDialogState(prev => ({
      ...prev,
      pendingValue: valueToConfirm,
      awaitingConfirmation: true,
    }));

    speak(`Ho capito: ${valueToConfirm}. È giusto?`);
    startListening();
  }

  // Avvia l'ascolto vocale
  function startListening() {
    if (recognitionRef.current) {
      setTimeout(() => {
        try {
          recognitionRef.current?.start();
        } catch (e) {
          // Già in ascolto, ignora
        }
      }, 1500); // pausa per far finire il TTS
    }
  }

  // Conferma e passa al prossimo campo
  function confirmAndNext() {
    if (!dialogState.currentField) return;

    // Trascrivi il valore nel form
    updateField(dialogState.currentField, dialogState.pendingValue);

    // Passa al campo successivo
    goToNextField();
  }

  // Vai al prossimo campo
  function goToNextField() {
    const currentIndex = fieldOrder.findIndex(f => f.key === dialogState.currentField);
    const nextIndex = currentIndex + 1;

    if (nextIndex >= fieldOrder.length) {
      // Fine! Chiedi se salvare
      speak('Ho finito la raccolta dati. Vuoi salvare il cliente?');
      setDialogState(prev => ({
        ...prev,
        currentField: null,
        pendingValue: '',
        awaitingConfirmation: true,
      }));
      startListening();
      return;
    }

    const nextField = fieldOrder[nextIndex];
    setDialogState({
      active: true,
      currentField: nextField.key,
      pendingValue: '',
      awaitingConfirmation: false,
    });

    setTimeout(() => {
      askCurrentField(nextField);
      startListening();
    }, 500);
  }

  // Salva il cliente
  async function saveClient() {
    setSaving(true);
    setErrorMsg(null);
    setResultMsg(null);

    // Validazione campi obbligatori
    if (!form.nomeCliente.trim()) {
      setErrorMsg('Il nome del cliente è obbligatorio.');
      setSaving(false);
      return;
    }
    if (!form.citta.trim()) {
      setErrorMsg('La città è obbligatoria.');
      setSaving(false);
      return;
    }
    if (!form.indirizzo.trim()) {
      setErrorMsg('L\'indirizzo è obbligatorio.');
      setSaving(false);
      return;
    }
    if (!form.tipoLocale.trim()) {
      setErrorMsg('Il tipo di locale è obbligatorio.');
      setSaving(false);
      return;
    }
    if (!form.nomeContatto.trim()) {
      setErrorMsg('Il nome del contatto è obbligatorio.');
      setSaving(false);
      return;
    }
    if (!form.telefono.trim()) {
      setErrorMsg('Il telefono è obbligatorio.');
      setSaving(false);
      return;
    }

    // Attendi che crypto sia pronto
    if (!crypto || !actuallyReady) {
      setErrorMsg('Crittografia non ancora pronta. Attendi...');
      setSaving(false);
      return;
    }

    try {
      const scope = 'table:accounts';
      
      // 🔧 FIX BUG CRITICO: Genera UUID PRIMA di cifrare!
      // L'ID deve essere lo stesso usato come AAD in cifratura E decifratura
      const accountId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      console.log('[QuickAdd] 🔑 ID account generato:', accountId);
      
      // Critta il nome cliente usando encryptFields
      const nameEncrypted = await crypto.encryptFields(
        scope,
        'accounts',
        accountId, // ✅ FIX: Usa l'ID generato come AAD
        { name: form.nomeCliente.trim() }
      );

      // ✅ VALIDAZIONE struttura nome cliente cifrato
      if (!nameEncrypted || typeof nameEncrypted !== 'object') {
        throw new Error(
          'Cifratura nome cliente fallita: encryptFields ha ritornato dati non validi. ' +
          'Tipo ritornato: ' + typeof nameEncrypted
        );
      }

      if (!nameEncrypted.name_enc || !nameEncrypted.name_iv) {
        throw new Error(
          'Cifratura nome cliente fallita: campi enc/iv mancanti nella risposta. ' +
          'Campi presenti: ' + Object.keys(nameEncrypted).join(', ')
        );
      }

      console.log('[QuickAdd] Nome cliente cifrato con successo:', {
        hasEnc: !!nameEncrypted.name_enc,
        hasIv: !!nameEncrypted.name_iv,
      });
      
      // Verifica che computeBlindIndex sia disponibile
      if (typeof crypto.computeBlindIndex !== 'function') {
        throw new Error(
          'La funzione computeBlindIndex non è disponibile sul servizio crypto. ' +
          'Rieffettua il login o contatta il supporto.'
        );
      }

      // Calcola il blind index (obbligatorio)
      const nameBlind = await crypto.computeBlindIndex(scope, form.nomeCliente.trim());

      // Verifica che sia valido
      if (!nameBlind || typeof nameBlind !== 'string') {
        throw new Error('Calcolo blind index fallito: valore non valido ritornato');
      }

      // 🔐 CIFRA NOME CONTATTO (obbligatorio)
      const contactNameEncrypted = await crypto.encryptFields(
        scope,
        'accounts',
        accountId, // ✅ FIX: Usa stesso ID
        { contact_name: form.nomeContatto.trim() }
      );

      // ✅ VALIDAZIONE struttura nome contatto cifrato
      if (!contactNameEncrypted || typeof contactNameEncrypted !== 'object') {
        throw new Error(
          'Cifratura nome contatto fallita: encryptFields ha ritornato dati non validi. ' +
          'Tipo ritornato: ' + typeof contactNameEncrypted
        );
      }

      if (!contactNameEncrypted.contact_name_enc || !contactNameEncrypted.contact_name_iv) {
        throw new Error(
          'Cifratura nome contatto fallita: campi enc/iv mancanti nella risposta. ' +
          'Campi presenti: ' + Object.keys(contactNameEncrypted).join(', ')
        );
      }

      console.log('[QuickAdd] Nome contatto cifrato con successo:', {
        hasEnc: !!contactNameEncrypted.contact_name_enc,
        hasIv: !!contactNameEncrypted.contact_name_iv,
      });

      // 🔐 CIFRA EMAIL (se presente)
      let emailEncrypted = null;
      if (form.email.trim()) {
        emailEncrypted = await crypto.encryptFields(
          scope,
          'accounts',
          accountId, // ✅ FIX: Usa stesso ID
          { email: form.email.trim() }
        );
        if (!emailEncrypted?.email_enc || !emailEncrypted?.email_iv) {
          throw new Error('Cifratura email fallita');
        }
        console.log('[QuickAdd] Email cifrata con successo');
      }

      // 🔐 CIFRA TELEFONO
      const phoneEncrypted = await crypto.encryptFields(
        scope,
        'accounts',
        accountId, // ✅ FIX: Usa stesso ID
        { phone: form.telefono.trim() }
      );
      if (!phoneEncrypted?.phone_enc || !phoneEncrypted?.phone_iv) {
        throw new Error('Cifratura telefono fallita');
      }
      console.log('[QuickAdd] Telefono cifrato con successo');

      // 🔐 CIFRA INDIRIZZO
      const addressEncrypted = await crypto.encryptFields(
        scope,
        'accounts',
        accountId, // ✅ FIX: Usa stesso ID
        { address: form.indirizzo.trim() }
      );
      if (!addressEncrypted?.address_enc || !addressEncrypted?.address_iv) {
        throw new Error('Cifratura indirizzo fallita');
      }
      console.log('[QuickAdd] Indirizzo cifrato con successo');

      // 🔐 CIFRA P.IVA (se presente)
      let pivaEncrypted = null;
      if (form.piva.trim()) {
        pivaEncrypted = await crypto.encryptFields(
          scope,
          'accounts',
          accountId, // ✅ FIX: Usa stesso ID
          { vat_number: form.piva.trim() }
        );
        if (!pivaEncrypted?.vat_number_enc || !pivaEncrypted?.vat_number_iv) {
          throw new Error('Cifratura P.IVA fallita');
        }
        console.log('[QuickAdd] P.IVA cifrata con successo');
      }

      // 🗺️ GEOCODING automatico (NON bloccante)
      let latitude: string | undefined = undefined;
      let longitude: string | undefined = undefined;
      
      try {
        console.log('[QuickAdd] 📍 Geocoding indirizzo...');
        const coords = await geocodeAddress(form.indirizzo.trim(), form.citta.trim());
        
        if (coords) {
          latitude = coords.latitude.toFixed(8);
          longitude = coords.longitude.toFixed(8);
          console.log('[QuickAdd] ✅ Geocoding completato:', { latitude, longitude });
        } else {
          console.warn('[QuickAdd] ⚠️ Geocoding fallito: coordinate non trovate');
        }
      } catch (geocodeError: any) {
        console.warn('[QuickAdd] ⚠️ Errore geocoding (non bloccante):', geocodeError.message);
        // Non blocchiamo il salvataggio se il geocoding fallisce
      }

      // Prepara i dati custom (SOLO città, tipo, note in chiaro)
      const customData = {
        notes: form.note.trim() || undefined,
      };

      // Prepara il payload
      const payload: any = {
        id: accountId, // ✅ FIX: Invia l'ID usato per cifrare, così il DB userà lo stesso!
        name_enc: nameEncrypted.name_enc,
        name_iv: nameEncrypted.name_iv,
        name_bi: nameBlind,
        address_enc: addressEncrypted.address_enc,
        address_iv: addressEncrypted.address_iv,
        contact_name_enc: contactNameEncrypted.contact_name_enc,
        contact_name_iv: contactNameEncrypted.contact_name_iv,
        ...(pivaEncrypted && {
          vat_number_enc: pivaEncrypted.vat_number_enc,
          vat_number_iv: pivaEncrypted.vat_number_iv,
        }),
        ...(emailEncrypted && {
          email_enc: emailEncrypted.email_enc,
          email_iv: emailEncrypted.email_iv,
        }),
        phone_enc: phoneEncrypted.phone_enc,
        phone_iv: phoneEncrypted.phone_iv,
        city: form.citta.trim(),
        tipo_locale: form.tipoLocale.trim(),
        custom: customData,
      };

      // Aggiungi coordinate GPS se disponibili
      if (latitude && longitude) {
        payload.latitude = latitude;
        payload.longitude = longitude;
      }

      console.log('🔍 [QuickAdd] Payload da inviare all\'API:', JSON.stringify(payload, null, 2));

      const res = await fetch('/api/clients/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(`Errore: ${data?.error ?? res.status}`);
      } else {
        const geoMsg = latitude && longitude ? ' con coordinate GPS' : '';
        setResultMsg(`✅ Cliente salvato${geoMsg}! ID: ${data.accountId}`);
        // 🔇 TTS disabilitato temporaneamente (nota UX del 01/12)
        // speak('Cliente salvato con successo!');
        
        // Reset form dopo 2 secondi
        setTimeout(() => {
          setForm({
            nomeCliente: '',
            piva: '',
            citta: '',
            indirizzo: '',
            tipoLocale: '',
            nomeContatto: '',
            telefono: '',
            email: '',
            note: '',
          });
          setResultMsg(null);
        }, 2000);
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  // Se siamo alla fine del dialogo e l'utente conferma, salva
  useEffect(() => {
    if (dialogState.awaitingConfirmation && dialogState.currentField === null && dialogState.active) {
      // Questo è il momento della conferma finale
      // L'handler è già in handleVoiceInput
    }
  }, [dialogState]);

  // 🆕 Check se utente ha fatto "skip" senza dati (faccio un giro)
  const hasSkippedOnboarding = typeof window !== 'undefined' && (() => {
    try {
      const onboardingData = localStorage.getItem('reping:onboarding_import_done');
      if (onboardingData) {
        const parsed = JSON.parse(onboardingData);
        return parsed.skipped === true;
      }
    } catch {}
    return false;
  })();

  // 🎮 Check se è modalità demo
  const isDemoMode = typeof window !== 'undefined' && 
    sessionStorage.getItem('reping:isAnonDemo') === 'true';

  // 🔐 Blocco UI se crittografia non è pronta
  // 🔧 FIX: Bypass per demo/skip mode
  if (!isDemoMode && !hasSkippedOnboarding && (!actuallyReady || !crypto)) {
    return (
      <div style={{ maxWidth: 600, margin: '80px auto', padding: 24, border: '1px solid #e5e7eb', borderRadius: 12 }}>
        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 12, color: '#111827' }}>
          🔐 Crittografia in preparazione...
        </h2>
        <p style={{ color: '#6b7280', marginBottom: 16, lineHeight: 1.6 }}>
          Il sistema di cifratura sta inizializzando. Questo può richiedere qualche secondo dopo il login.
        </p>
        <p style={{ color: '#6b7280', marginBottom: 20, fontSize: 14 }}>
          Se questa schermata persiste per più di 10 secondi, prova a:
        </p>
        <ul style={{ color: '#6b7280', marginBottom: 24, paddingLeft: 20, fontSize: 14 }}>
          <li style={{ marginBottom: 8 }}>Tornare alla home e attendere</li>
          <li style={{ marginBottom: 8 }}>Effettuare logout e nuovo login</li>
          <li>Ricaricare la pagina</li>
        </ul>
        
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={() => router.push('/')}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: 'white',
              color: '#111827',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ← Torna alla Home
          </button>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: 'white',
              color: '#111827',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🔄 Ricarica Pagina
          </button>
        </div>
        
        {/* Info debug */}
        <div style={{ 
          marginTop: 24, 
          padding: 12, 
          background: '#fef3c7', 
          borderRadius: 8,
          fontSize: 13,
          fontFamily: 'monospace',
        }}>
          <strong>Debug:</strong><br />
          • ready: {String(ready)}<br />
          • crypto: {crypto ? 'presente' : 'null'}<br />
          • isUnlocked: {crypto && typeof crypto.isUnlocked === 'function' ? String(crypto.isUnlocked()) : 'n/a'}<br />
          • actuallyReady: {String(actuallyReady)}
        </div>
      </div>
    );
  }
    
  return (
    <>
      {/* TopBar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, background: "white", borderBottom: "1px solid #e5e7eb" }}>
        <TopBar
          title="Aggiungi Cliente"
          onOpenLeft={openLeft}
          onOpenDati={openDati}
          onOpenDocs={openDocs}
          onOpenImpostazioni={openImpostazioni}
          onLogout={logout}
        />
      </div>

      <div style={{ maxWidth: 900, margin: '40px auto', padding: 24 }}>
        {/* Spacer per TopBar */}
        <div style={{ height: 70 }} />

        {/* Header */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ color: '#6b7280' }}>
            Compila il form manualmente o attiva il dialogo vocale per inserire i dati a voce.
          </p>
        </div>

        {/* Controlli dialogo vocale */}
        <div style={{ marginBottom: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          {!dialogState.active ? (
            <button
              onClick={startDialog}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#10b981',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🎤 Avvia Dialogo Vocale
            </button>
          ) : (
            <button
              onClick={stopDialog}
              style={{
                padding: '10px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#ef4444',
                color: 'white',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              🛑 Ferma Dialogo
            </button>
          )}

          {dialogState.active && (
            <span style={{ color: '#10b981', fontWeight: 500 }}>
              🎙️ Dialogo attivo - Campo: {dialogState.currentField || 'conferma finale'}
            </span>
          )}
        </div>

        {/* Form */}
        <div style={{ background: '#f9fafb', padding: 24, borderRadius: 12, border: '1px solid #e5e7eb' }}>
          {/* DATI PRINCIPALI */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>📋 Dati Principali</h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Nome Cliente */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                  Nome Cliente/Azienda *
                </label>
                <input
                  type="text"
                  value={form.nomeCliente}
                  onChange={(e) => updateField('nomeCliente', e.target.value)}
                  placeholder="Es. Pizzeria Da Mario"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </div>

              {/* Città */}
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                  Città *
                </label>
                <input
                  type="text"
                  value={form.citta}
                  onChange={(e) => updateField('citta', e.target.value)}
                  placeholder="Es. Milano"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </div>

              {/* Indirizzo */}
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                  Via e Num. Civico *
                </label>
                <input
                  type="text"
                  value={form.indirizzo}
                  onChange={(e) => updateField('indirizzo', e.target.value)}
                  placeholder="Es. Via Roma, 123"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </div>

              {/* Tipo Locale */}
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                  Tipo di Locale *
                </label>
                <select
                  value={form.tipoLocale}
                  onChange={(e) => updateField('tipoLocale', e.target.value)}
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                >
                  <option value="">Seleziona...</option>
                  {TIPO_LOCALE.map(tipo => (
                    <option key={tipo} value={tipo}>{tipo}</option>
                  ))}
                </select>
              </div>

              {/* P.IVA */}
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                  P.IVA (opzionale)
                </label>
                <input
                  type="text"
                  value={form.piva}
                  onChange={(e) => updateField('piva', e.target.value)}
                  placeholder="Es. IT12345678901"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </div>
            </div>
          </div>

          {/* CONTATTO */}
          <div style={{ marginBottom: 24 }}>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>👤 Contatto Principale</h2>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Nome Contatto */}
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                  Nome Contatto *
                </label>
                <input
                  type="text"
                  value={form.nomeContatto}
                  onChange={(e) => updateField('nomeContatto', e.target.value)}
                  placeholder="Es. Mario Rossi"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </div>

              {/* Telefono */}
              <div>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                  Telefono *
                </label>
                <input
                  type="tel"
                  value={form.telefono}
                  onChange={(e) => updateField('telefono', e.target.value)}
                  placeholder="Es. 333 1234567"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </div>

              {/* Email */}
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={{ display: 'block', marginBottom: 6, fontWeight: 500 }}>
                  Email (opzionale)
                </label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="Es. mario@pizzeria.it"
                  style={{
                    width: '100%',
                    padding: 10,
                    borderRadius: 8,
                    border: '1px solid #d1d5db',
                    fontSize: 14,
                  }}
                />
              </div>
            </div>
          </div>

          {/* NOTE */}
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>📝 Note</h2>
            
            <textarea
              value={form.note}
              onChange={(e) => updateField('note', e.target.value)}
              placeholder="Note aggiuntive sul cliente..."
              rows={4}
              style={{
                width: '100%',
                padding: 10,
                borderRadius: 8,
                border: '1px solid #d1d5db',
                fontSize: 14,
                resize: 'vertical',
              }}
            />
          </div>
        </div>

        {/* Azioni */}
        <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            onClick={() => router.push('/')}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: '1px solid #d1d5db',
              background: 'white',
              color: '#111827',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ← Annulla
          </button>

          <button
            onClick={saveClient}
            disabled={saving || dialogState.active}
            style={{
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              background: saving || dialogState.active ? '#9ca3af' : '#111827',
              color: 'white',
              fontWeight: 600,
              cursor: saving || dialogState.active ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? 'Salvataggio...' : '✅ Salva Cliente'}
          </button>

          {resultMsg && (
            <span style={{ color: '#10b981', fontWeight: 500 }}>{resultMsg}</span>
          )}
          {errorMsg && (
            <span style={{ color: '#ef4444', fontWeight: 500 }}>{errorMsg}</span>
          )}
        </div>
      </div>

      {/* Drawer */}
      <div style={{ position: "relative", zIndex: 2001 }}>
        <LeftDrawer open={leftOpen} onClose={closeLeft} onSelect={() => {}} />
        <RightDrawer open={rightOpen} content={rightContent} onClose={closeRight} />
      </div>
    </>
  );
}

// 🔧 FIX: Wrap in Suspense per useSearchParams (Next.js 14 requirement)
export default function QuickAddClientPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}>Caricamento...</div>}>
      <QuickAddClientContent />
    </Suspense>
  );
}
