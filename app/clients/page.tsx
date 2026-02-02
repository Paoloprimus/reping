// app/clients/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { useCrypto } from "@/lib/crypto/CryptoProvider";
import { useDrawers, DrawersWithBackdrop } from '@/components/Drawers';
import TopBar from "@/components/home/TopBar";

// Opzioni per tipo locale
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

// helper: prendi sempre la decryptFields "viva" da window.debugCrypto
function getDbg(): any | null {
  if (typeof window === "undefined") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (window as any).debugCrypto ?? null;
}

// Tipi
type RawAccount = {
  id: string;
  created_at: string;

  // encrypted (opzionali)
  name_enc?: any; name_iv?: any;
  contact_name_enc?: any; contact_name_iv?: any;
  city?: string; 
  tipo_locale?: string;
  email_enc?: any; email_iv?: any;
  phone_enc?: any; phone_iv?: any;
  vat_number_enc?: any; vat_number_iv?: any;
  address_enc?: any; address_iv?: any;
  
  // plain text (fallback per dati demo/non cifrati)
  name?: string;
  notes?: string;
  type?: string;
  street?: string;
  note?: string;
  
  // custom (plain text per LLM)
  custom?: any;
};

type PlainAccount = {
  id: string;
  created_at: string;
  name: string;
  contact_name: string;
  city: string;
  tipo_locale: string;
  email: string;
  phone: string;
  vat_number: string;
  notes: string;
};

type SortKey = "name" | "contact_name" | "city" | "tipo_locale" | "email" | "phone" | "vat_number" | "created_at";

const DEFAULT_SCOPES = [
  "table:accounts", "table:contacts", "table:products",
  "table:profiles", "table:notes", "table:conversations",
  "table:messages", "table:proposals",
];

export default function ClientsPage(): JSX.Element {
  const { crypto, ready, unlock, prewarm } = useCrypto();
  
  // Drawer
  const { leftOpen, rightOpen, rightContent, openLeft, closeLeft, openDati, openDocs, openImpostazioni, closeRight } = useDrawers();

  const actuallyReady = ready || !!(crypto as any)?.isUnlocked?.();

useEffect(() => {
  // Spegni checking quando:
  // 1. Crypto è ready E unlocked
  // 2. OPPURE passato abbastanza tempo senza unlock in corso
  if (actuallyReady) {
    setChecking(false);
  } else {
    const timer = setTimeout(() => {
      if (!unlockingRef.current) {
        setChecking(false);
      }
    }, 3000);
    return () => clearTimeout(timer);
  }
}, [actuallyReady]);
  
  
  // ready "reale": se il provider non ha aggiornato lo stato ma il servizio è sbloccato, considera pronto
  const [rows, setRows] = useState<PlainAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  const [sortBy, setSortBy] = useState<SortKey>("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [q, setQ] = useState<string>("");

  // 🆕 Funzione per gestire click su header ordinabili
function handleSortClick(key: SortKey) {
  if (sortBy === key) {
    // Stessa colonna → inverti direzione
    setSortDir(sortDir === "asc" ? "desc" : "asc");
  } else {
    // Colonna nuova → imposta quella colonna e DESC
    setSortBy(key);
    setSortDir("desc");
  }
}

  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);

  const [diag, setDiag] = useState({ auth: "", ready: false, passInStorage: false, unlockAttempts: 0, loaded: 0 });
  const unlockingRef = useRef(false);

  const [pass, setPass] = useState("");

  const [checking, setChecking] = useState(true);

  // 🆕 STATO PER EDITING INLINE
  const [editingCell, setEditingCell] = useState<{rowId: string, field: string} | null>(null);
  const [tempValue, setTempValue] = useState("");

  // 🆕 STATO PER MODAL ELIMINAZIONE
  const [deleteModal, setDeleteModal] = useState<{open: boolean, clientId: string | null, clientName: string}>({
    open: false,
    clientId: null,
    clientName: ''
  });

// Logout
async function logout() {
  // Pulisci la passphrase
  try { sessionStorage.removeItem("repping:pph"); } catch {}
  try { localStorage.removeItem("repping:pph"); } catch {}
  
  await supabase.auth.signOut();
  window.location.href = "/login";
}

  // 🔐 (disattivato) Auto-unlock locale in /clients: lasciamo che ci pensi il CryptoProvider
  useEffect(() => {
    if (!authChecked) return;

    const pass =
      typeof window !== "undefined"
        ? (sessionStorage.getItem("repping:pph") || localStorage.getItem("repping:pph") || "")
        : "";

    setDiag((d) => ({ ...d, passInStorage: !!pass }));
    // Non facciamo nulla qui. Niente unlock/prewarm: evita doppie aperture e OperationError.
  }, [authChecked]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      if (error) {
        setUserId(null);
        setDiag((d) => ({ ...d, auth: `getUser error: ${error.message}` }));
      } else {
        const uid = data.user?.id ?? null;
        setUserId(uid);
        setDiag((d) => ({ ...d, auth: uid ? "ok" : "null" }));
      }
      setAuthChecked(true);
    })();
    return () => { alive = false; };
  }, []);

// 🔐 Auto-unlock FORZATO: sblocca e carica dati
useEffect(() => {
  if (!authChecked) return;
  
  // 🎮 Demo mode: carica dati in chiaro senza cifratura
  const isDemoMode = sessionStorage.getItem('reping:isAnonDemo') === 'true';
  if (isDemoMode) {
    console.log('[/clients] 🎮 Demo mode - carico dati in chiaro');
    loadClients();
    return;
  }
  
  if (!crypto) return;
  
  console.log('[/clients] 🔍 Check unlock status:', {
    isUnlocked: crypto.isUnlocked?.(),
    unlockingInProgress: unlockingRef.current,
  });
  
  // Se già unlocked, skip
  if (typeof crypto.isUnlocked === 'function' && crypto.isUnlocked()) {
    console.log('[/clients] ✅ Crypto già unlocked');
    return;
  }
  
  // Se già sta unlockando, skip
  if (unlockingRef.current) {
    console.log('[/clients] ⏳ Unlock già in corso');
    return;
  }

  // 🔧 FIX: Ritenta lettura passphrase con delay (Android lento)
  async function tryGetPassphrase(): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const pass = sessionStorage.getItem('repping:pph') || localStorage.getItem('repping:pph') || '';
      if (pass) return pass;
      if (attempt < 2) {
        console.log(`[/clients] ⏳ Passphrase non trovata, attendo... (${attempt + 1}/3)`);
        await new Promise(r => setTimeout(r, 300));
      }
    }
    return '';
  }

  // FORZA unlock + caricamento dati
  (async () => {
    try {
      unlockingRef.current = true;
      
      const pass = await tryGetPassphrase();
      console.log('[/clients] 🔑 Passphrase trovata:', !!pass);
      
      if (!pass) {
        console.log('[/clients] ❌ Nessuna passphrase in storage dopo retry');
        return;
      }
      
      setDiag((d) => ({ ...d, passInStorage: true, unlockAttempts: (d.unlockAttempts ?? 0) + 1 }));
      
      console.log('[/clients] 🔓 Avvio unlock...');
      await unlock(pass);
      console.log('[/clients] ✅ Unlock completato!');
      
      // 🔧 FIX: Attendi un momento per assicurarsi che MK sia pronta
      await new Promise(r => setTimeout(r, 100));
      
      console.log('[/clients] 🔧 Avvio prewarm...');
      await prewarm(DEFAULT_SCOPES);
      console.log('[/clients] ✅ Prewarm completato!');
      
      // 🔧 FIX: Attendi ancora un momento prima di caricare dati
      await new Promise(r => setTimeout(r, 100));
      
      // 🚀 FORZA caricamento dati dopo unlock
      console.log('[/clients] 📊 Carico i dati...');
      await loadClients();
      console.log('[/clients] ✅ Dati caricati!');
      
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      console.error('[/clients] ❌ Unlock fallito:', msg);
      
      // 🔧 FIX: NON rimuovere la passphrase! Potrebbe essere solo un errore temporaneo
      // La rimozione causava il bug su Android dove la passphrase veniva cancellata erroneamente
      console.warn('[/clients] ⚠️ Errore durante unlock, ma mantengo passphrase');
    } finally {
      unlockingRef.current = false;
    }
  })();
}, [authChecked, crypto, unlock, prewarm]);

  async function loadClients(): Promise<void> {
    if (!userId) return;
    
    // 🆕 Se utente ha fatto skip o è in demo mode, carica solo dati in chiaro
    const isDemoOrSkip = 
      sessionStorage.getItem('reping:isAnonDemo') === 'true' ||
      (() => {
        try {
          const onboardingData = localStorage.getItem('reping:onboarding_import_done');
          if (onboardingData) {
            const parsed = JSON.parse(onboardingData);
            return parsed.skipped === true;
          }
        } catch {}
        return false;
      })();
    
    // Se non c'è crypto e non è demo/skip mode, non possiamo caricare
    if (!crypto && !isDemoOrSkip) return;
    
    setLoading(true);

const { data, error } = await supabase
  .from("accounts")
  .select(
    "id,created_at," +
    "name,name_enc,name_iv," +  // name in chiaro + cifrato
    "contact_name_enc,contact_name_iv," +
    "city," + 
    "tipo_locale,type," +  // tipo_locale + type (alias)
    "email_enc,email_iv," +
    "phone_enc,phone_iv," +
    "vat_number_enc,vat_number_iv," +
    "address_enc,address_iv," +
    "street,notes,note," +  // street, notes e note (alias)
    "custom"
  )
  .order("created_at", { ascending: false });

    if (error) {
      console.error("[/clients] load error:", error);
      setLoading(false);
      return;
    }

    const rowsAny = (data ?? []) as any[];
    const plain: PlainAccount[] = [];

    // 🆕 Se è demo/skip mode, usa solo dati in chiaro senza decifratura
    if (isDemoOrSkip) {
      console.log('[/clients] 🎮 Modo demo/skip - uso dati in chiaro');
      for (const r0 of rowsAny) {
        const r = r0 as RawAccount;
        const customData = r.custom || {};
        plain.push({
          id: r.id,
          created_at: r.created_at,
          name: r.name || "",
          contact_name: customData.contact_name || "",
          city: r.city || "",
          tipo_locale: r.tipo_locale || r.type || "",
          email: customData.email || "",
          phone: customData.phone || "",
          vat_number: "",
          notes: r.notes || r.note || "",
        });
      }
    } else {
      // ✅ Forza creazione scope keys PRIMA di decifrare (con retry)
      let scopeKeysReady = false;
      for (let attempt = 0; attempt < 3 && !scopeKeysReady; attempt++) {
        try {
          console.log(`[/clients] 🔧 Creo scope keys... (tentativo ${attempt + 1}/3)`);
          await (crypto as any).getOrCreateScopeKeys('table:accounts');
          console.log('[/clients] ✅ Scope keys creati');
          scopeKeysReady = true;
        } catch (e) {
          console.error('[/clients] ❌ Errore creazione scope keys:', e);
          if (attempt < 2) {
            await new Promise(r => setTimeout(r, 300));
          }
        }
      }
      
      if (!scopeKeysReady) {
        console.error('[/clients] ❌ CRITICO: Impossibile creare scope keys dopo 3 tentativi');
      }

      // DEBUG logs (opzionali, puoi rimuoverli dopo il test)
      if (data && data.length > 0) {
        const firstRecord = data[0] as any;
        console.log('🔍 [DEBUG] Primo record RAW:', firstRecord.name_enc?.substring(0, 20) + '...');
      }

      for (const r0 of rowsAny) {
        const r = r0 as RawAccount;
        try {
          const hasEncrypted =
          !!(r.name_enc || r.email_enc || r.phone_enc || r.vat_number_enc || r.address_enc);

          // 🔧 FIX: Converti hex-string in base64 (ORIGINALE - NON MODIFICATO!)
          const hexToBase64 = (hexStr: any): string => {
            if (!hexStr || typeof hexStr !== 'string') return '';
            if (!hexStr.startsWith('\\x')) return hexStr;
            
            const hex = hexStr.slice(2);
            const bytes = hex.match(/.{1,2}/g)?.map(b => String.fromCharCode(parseInt(b, 16))).join('') || '';
            return bytes;
          };
          
          const recordForDecrypt = {
            ...r,
            name_enc: hexToBase64(r.name_enc),
            name_iv: hexToBase64(r.name_iv),
            contact_name_enc: hexToBase64(r.contact_name_enc),
            contact_name_iv: hexToBase64(r.contact_name_iv),
            email_enc: hexToBase64(r.email_enc),
            email_iv: hexToBase64(r.email_iv),
            phone_enc: hexToBase64(r.phone_enc),
            phone_iv: hexToBase64(r.phone_iv),
            vat_number_enc: hexToBase64(r.vat_number_enc),
            vat_number_iv: hexToBase64(r.vat_number_iv),
            address_enc: hexToBase64(r.address_enc),
            address_iv: hexToBase64(r.address_iv),
          };

          if (typeof (crypto as any)?.decryptFields !== "function") {
            throw new Error("decryptFields non disponibile");
          }
          
          const toObj = (x: any): Record<string, unknown> =>
            Array.isArray(x)
              ? x.reduce((acc: Record<string, unknown>, it: any) => {
                  if (it && typeof it === "object" && "name" in it) acc[it.name] = it.value ?? "";
                  return acc;
                }, {})
              : ((x ?? {}) as Record<string, unknown>);

          // ✅✅✅ FIX: Usa l'ID del record come Associated Data (firma)
          const decAny = await (crypto as any).decryptFields(
            "table:accounts", 
            "accounts", 
            r.id, // <--- PUNTO CRITICO: Usa r.id invece di ''
            recordForDecrypt,
            ["name", "contact_name", "email", "phone", "vat_number", "address"]
          );

          const dec = toObj(decAny);
          
          // 🔧 FIX BUG #2: Log dettagliato se decifratura fallisce
          if (!dec.name && r.name_enc) {
            console.warn('[/clients] ⚠️ Decifratura nome fallita per', r.id, {
              hasNameEnc: !!r.name_enc,
              hasNameIv: !!r.name_iv,
              decResult: dec,
            });
          }

          // ✅ Estrai campi in chiaro (fallback per dati demo/non cifrati)
          const notes = r.notes || r.note || "";
          const city = r.city || "";
          const tipoLocale = r.tipo_locale || r.type || "";
          const plainName = r.name || "";  // nome in chiaro (per dati demo)
          const plainStreet = r.street || "";

          // 🔧 Usa nome in chiaro come fallback se decifratura non produce risultato
          const finalName = String(dec.name || plainName || "");

          plain.push({
            id: r.id,
            created_at: r.created_at,
            name: finalName,  // usa fallback se decifratura fallisce
            contact_name: String(dec.contact_name ?? ""),
            city: String(city),
            tipo_locale: String(tipoLocale),
            email: String(dec.email ?? ""),
            phone: String(dec.phone ?? ""),
            vat_number: String(dec.vat_number ?? ""),
            notes: String(notes),
          });
          
        } catch (e) {
          console.warn("[/clients] decrypt error for", r.id, e);
          // 🔧 Usa campi in chiaro come fallback in caso di errore
          plain.push({
            id: r.id,
            created_at: r.created_at,
            name: r.name || "",  // fallback al nome in chiaro (per dati demo)
            contact_name: "", 
            city: r.city || "",
            tipo_locale: r.tipo_locale || r.type || "",
            email: "", 
            phone: "", 
            vat_number: "", 
            notes: r.notes || r.note || "",
          });
        }
      }
    }

    setRows(plain);
    setLoading(false);
    setDiag((d) => ({ ...d, loaded: plain.length }));
  }

  // carica dati appena la cifratura è sbloccata e c'è l'utente
useEffect(() => {
  // 🆕 Check se è demo o skip mode
  const isDemoOrSkip = 
    sessionStorage.getItem('reping:isAnonDemo') === 'true' ||
    (() => {
      try {
        const onboardingData = localStorage.getItem('reping:onboarding_import_done');
        if (onboardingData) {
          const parsed = JSON.parse(onboardingData);
          return parsed.skipped === true;
        }
      } catch {}
      return false;
    })();

  // Se è demo/skip mode, carica subito senza aspettare crypto
  if (isDemoOrSkip && userId && !loading) {
    console.log('[/clients] 🎮 Demo/skip mode - carico subito');
    setChecking(false);
    loadClients();
    return;
  }

  if (actuallyReady) {
    // Appena ready, spegni subito checking
    setChecking(false);
    
    // 🔧 FIX: Ricarica dati se la lista è vuota (navigazione da altra pagina)
    if (rows.length === 0 && userId && !loading) {
      console.log('[/clients] 🔄 Ricarico dati (navigazione)');
      loadClients();
    }
  } else {
    // Controlla se c'è password in storage
    const hasPass = !!(sessionStorage.getItem('repping:pph') || localStorage.getItem('repping:pph'));
    
    // Se c'è password, aspetta 5 secondi (auto-unlock in corso)
    // Se non c'è, aspetta solo 1 secondo
    const delay = hasPass ? 5000 : 1000;
    
    const timer = setTimeout(() => {
      setChecking(false);
    }, delay);
    
    return () => clearTimeout(timer);
  }
}, [actuallyReady, userId, rows.length]);

  const view: PlainAccount[] = useMemo(() => {
    const norm = (s: string) => (s || "").toLocaleLowerCase();
    let arr = [...rows];
    if (q.trim()) {
      const qq = norm(q);
arr = arr.filter((r) =>
  norm(r.name).includes(qq) ||
  norm(r.contact_name).includes(qq) ||
  norm(r.city).includes(qq) ||
  norm(r.tipo_locale).includes(qq) ||
  norm(r.city).includes(qq) ||
  norm(r.email).includes(qq) ||
  norm(r.phone).includes(qq) ||
  norm(r.vat_number).includes(qq) ||
  norm(r.notes).includes(qq)
);
    }
    arr.sort((a, b) => {
      let va: string | number = a[sortBy] ?? "";
      let vb: string | number = b[sortBy] ?? "";
      if (sortBy === "created_at") {
        va = new Date(a.created_at).getTime();
        vb = new Date(b.created_at).getTime();
      }
      return sortDir === "asc" ? (va < vb ? -1 : va > vb ? 1 : 0) : (vb < va ? -1 : vb > va ? 1 : 0);
    });
    return arr;
  }, [rows, q, sortBy, sortDir]);

  // 🆕 UPDATE CAMPO CIFRATO
  async function updateField(clientId: string, fieldName: string, newValue: string) {
    if (!crypto || !userId) return;
    
    try {
      // Cifra il nuovo valore
      const fieldsToEncrypt: Record<string, string> = {};
      fieldsToEncrypt[fieldName] = newValue;
      
      const encrypted = await (crypto as any).encryptFields(
        "table:accounts",
        "accounts",
        clientId,
        fieldsToEncrypt
      );
      
      // Update su Supabase
      const { error } = await supabase
        .from("accounts")
        .update(encrypted)
        .eq("id", clientId);
      
      if (error) throw error;
      
      // Aggiorna la lista locale
      setRows(prev => prev.map(r => 
        r.id === clientId 
          ? { ...r, [fieldName]: newValue }
          : r
      ));
      
      console.log(`✅ Campo ${fieldName} aggiornato per cliente ${clientId}`);
    } catch (e) {
      console.error(`❌ Errore update ${fieldName}:`, e);
      alert(`Errore durante il salvataggio: ${e}`);
    }
  }

  // 🆕 UPDATE NOTES (custom field, non cifrato)
  async function updateNotes(clientId: string, newNotes: string) {
    if (!userId) return;
    
    try {
      // Recupera custom esistente
      const { data: acc } = await supabase
        .from("accounts")
        .select("custom")
        .eq("id", clientId)
        .single();
      
      const currentCustom = acc?.custom || {};
      const newCustom = { ...currentCustom, notes: newNotes };
      
      // Update
      const { error } = await supabase
        .from("accounts")
        .update({ custom: newCustom })
        .eq("id", clientId);
      
      if (error) throw error;
      
      // Aggiorna la lista locale
      setRows(prev => prev.map(r => 
        r.id === clientId 
          ? { ...r, notes: newNotes }
          : r
      ));
      
      console.log(`✅ Note aggiornate per cliente ${clientId}`);
    } catch (e) {
      console.error("❌ Errore update notes:", e);
      alert(`Errore durante il salvataggio: ${e}`);
    }
  }

// 🆕 UPDATE CITY (campo in chiaro)
async function updateCity(clientId: string, newCity: string) {
  if (!userId) return;
  
  try {
    // Update diretto (non cifrato)
    const { error } = await supabase
      .from("accounts")
      .update({ city: newCity })
      .eq("id", clientId);
    
    if (error) throw error;
    
    // Aggiorna la lista locale
    setRows(prev => prev.map(r => 
      r.id === clientId 
        ? { ...r, city: newCity }
        : r
    ));
    
    console.log(`✅ Città aggiornata per cliente ${clientId}`);
  } catch (e) {
    console.error("❌ Errore update city:", e);
    alert(`Errore durante il salvataggio: ${e}`);
  }
}

// 🆕 UPDATE TIPO_LOCALE (campo in chiaro)
async function updateTipoLocale(clientId: string, newTipoLocale: string) {
  if (!userId) return;
  
  try {
    // Update diretto (non cifrato)
    const { error } = await supabase
      .from("accounts")
      .update({ tipo_locale: newTipoLocale })
      .eq("id", clientId);
    
    if (error) throw error;
    
    // Aggiorna la lista locale
    setRows(prev => prev.map(r => 
      r.id === clientId 
        ? { ...r, tipo_locale: newTipoLocale }
        : r
    ));
    
    console.log(`✅ Tipo locale aggiornato per cliente ${clientId}`);
  } catch (e) {
    console.error("❌ Errore update tipo_locale:", e);
    alert(`Errore durante il salvataggio: ${e}`);
  }
}
  
  // 🆕 APRI MODAL ELIMINAZIONE
  function openDeleteModal(clientId: string, clientName: string) {
    setDeleteModal({ open: true, clientId, clientName });
  }

  // 🆕 CHIUDI MODAL ELIMINAZIONE
  function closeDeleteModal() {
    setDeleteModal({ open: false, clientId: null, clientName: '' });
  }

  // 🆕 CONFERMA ELIMINAZIONE
  async function confirmDelete() {
    if (!userId || !deleteModal.clientId) return;
    
    try {
      const { error } = await supabase
        .from("accounts")
        .delete()
        .eq("id", deleteModal.clientId);
      
      if (error) throw error;
      
      // Rimuovi dalla lista locale
      setRows(prev => prev.filter(r => r.id !== deleteModal.clientId));
      
      console.log(`✅ Cliente ${deleteModal.clientId} eliminato`);
      closeDeleteModal();
    } catch (e) {
      console.error("❌ Errore delete:", e);
      alert(`Errore durante l'eliminazione: ${e}`);
    }
  }

  // 🆕 GESTIONE EDITING
  function startEditing(rowId: string, field: string, currentValue: string) {
    setEditingCell({ rowId, field });
    setTempValue(currentValue);
  }

  function cancelEditing() {
    setEditingCell(null);
    setTempValue("");
  }

async function saveEditing() {
  if (!editingCell) return;
  
  const { rowId, field } = editingCell;
  
  // Gestione campi non cifrati
  if (field === "notes") {
    await updateNotes(rowId, tempValue);
  } else if (field === "city") {  // <-- AGGIUNGI QUESTO ELSE IF
    await updateCity(rowId, tempValue);
  } else if (field === "tipo_locale") {
    await updateTipoLocale(rowId, tempValue);
  } else {
    await updateField(rowId, field, tempValue);
  }
  
  cancelEditing();
}

  if (!authChecked) {
    return <div className="p-6 text-gray-600">Verifico sessione…</div>;
  }

  if (!userId) {
    return (
      <div className="p-6">
        <div className="mb-2 font-semibold">Sessione non attiva</div>
        <p className="text-sm text-gray-600">
          Effettua di nuovo l'accesso per vedere i tuoi clienti.
        </p>
        <button className="px-3 py-2 rounded border mt-3" onClick={() => window.location.href = "/login"}>
          Vai al login
        </button>
      </div>
    );
  }

  // 🎮 Check se è modalità demo (dati in chiaro, no cifratura)
  const isDemoMode = typeof window !== 'undefined' && 
    sessionStorage.getItem('reping:isAnonDemo') === 'true';

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

  // 🔧 FIX: Mostra loader durante auto-unlock, form SOLO se non c'è passphrase
  // In demo mode o skip mode, bypassa completamente il check crypto
  if (!isDemoMode && !hasSkippedOnboarding && (!actuallyReady || !crypto)) {
    const hasPassInStorage = typeof window !== 'undefined' && 
      (sessionStorage.getItem('repping:pph') || localStorage.getItem('repping:pph'));
    
    // Se c'è passphrase in storage O stiamo ancora provando, mostra loader
    if (hasPassInStorage || checking || unlockingRef.current) {
      return (
        <div className="p-6 max-w-md" style={{ textAlign: 'center', marginTop: 100 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔓</div>
          <div style={{ fontSize: 18, color: '#6b7280' }}>Sblocco dati in corso...</div>
          <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
            Decifratura automatica attiva
          </div>
        </div>
      );
    }
    
    // Nessuna passphrase → mostra form
    return (
      <div className="p-6 max-w-md space-y-3">
        <h2 className="text-lg font-semibold">🔐 Sblocca i dati cifrati</h2>
        <p className="text-sm text-gray-600">
          Inserisci la tua passphrase per sbloccare la cifratura client-side (valida per questa sessione).
        </p>
        <input
          type="password"
          className="border rounded p-2 w-full"
          placeholder="Passphrase"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
        />
        <button
          className="px-3 py-2 rounded border"
          onClick={async () => {
            try {
              await unlock(pass);
              await prewarm([
                "table:accounts","table:contacts","table:products","table:profiles",
                "table:notes","table:conversations","table:messages","table:proposals",
              ]);
              await loadClients();
              setPass("");
            } catch (e) {
              console.error("[/clients] unlock failed:", e);
              alert("Passphrase non valida o sblocco fallito.");
            }
          }}
        >
          Sblocca
        </button>
        <div className="text-xs text-gray-500">
          auth:{diag.auth} · ready:{String(ready)} · loaded:{diag.loaded}
        </div>
      </div>
    );
  }

return (
    <>
      {/* TopBar */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1000, background: "white", borderBottom: "1px solid #e5e7eb" }}>
        <TopBar
          title="Clienti"
          onOpenLeft={openLeft}
          onOpenDati={openDati}
          onOpenDocs={openDocs}
          onOpenImpostazioni={openImpostazioni}
          onLogout={logout}
        />
      </div>

      {checking ? (
        <div className="p-6 max-w-6xl mx-auto space-y-4">
          <div style={{ height: 70 }} />
          <div style={{ textAlign: 'center', marginTop: 100, fontSize: 18, color: '#6b7280' }}>
            ⏳ Caricamento clienti...
          </div>
        </div>
      ) : (
        <div className="p-6 max-w-6xl mx-auto space-y-4">
          {/* Spacer per TopBar */}
          <div style={{ height: 70 }} />

          <div className="flex gap-2 items-center">
            <input
              className="border rounded p-2 flex-1"
              placeholder="Cerca (nome, contatto, città, tipo locale, email, telefono, P. IVA, note)"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <button className="px-3 py-2 rounded border" onClick={() => setQ("")}>Pulisci</button>
            <button 
              className="px-4 py-2 rounded border-none text-white font-medium"
              style={{ background: '#2563eb', whiteSpace: 'nowrap' }}
              onClick={() => window.location.href = '/tools/quick-add-client'}
            >
              ➕ Nuovo Cliente
            </button>
          </div>

          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <Th label="Nome"       k="name"           sortBy={sortBy} sortDir={sortDir} onClick={handleSortClick} />
                  <Th label="Contatto"   k="contact_name"   sortBy={sortBy} sortDir={sortDir} onClick={handleSortClick} />
                  <Th label="Città"      k="city"           sortBy={sortBy} sortDir={sortDir} onClick={handleSortClick} />
                  <Th label="Tipo Locale" k="tipo_locale" sortBy={sortBy} sortDir={sortDir} onClick={handleSortClick} />
                  <Th label="Email"      k="email"       sortBy={sortBy} sortDir={sortDir} onClick={handleSortClick} />
                  <Th label="Telefono"   k="phone"       sortBy={sortBy} sortDir={sortDir} onClick={handleSortClick} />
                  <Th label="P. IVA"     k="vat_number"  sortBy={sortBy} sortDir={sortDir} onClick={handleSortClick} />
                  <Th label="Creato il"  k="created_at"  sortBy={sortBy} sortDir={sortDir} onClick={handleSortClick} />
                  <th className="px-3 py-2 text-left">Note</th>
                  <th className="px-3 py-2 text-left">Azioni</th>
                </tr>
              </thead>
              <tbody>
                {view.map((r) => (
                  <tr key={r.id} className="border-t hover:bg-gray-50">
                    {/* Nome - CLICCABILE per aprire scheda cliente */}
                    <td className="px-3 py-2 bg-gray-100">
                      <a 
                        href={`/clients/${r.id}`}
                        style={{ 
                          color: '#2563eb', 
                          textDecoration: 'none',
                          fontWeight: 500,
                        }}
                        title="Apri scheda cliente"
                      >
                        {r.name || "—"}
                      </a>
                    </td>
                    
                    {/* Contatto - EDITABILE */}
                    <EditableCell
                      rowId={r.id}
                      field="contact_name"
                      value={r.contact_name}
                      editingCell={editingCell}
                      tempValue={tempValue}
                      onStartEdit={startEditing}
                      onCancel={cancelEditing}
                      onSave={saveEditing}
                      onTempChange={setTempValue}
                    />
                    
                    {/* Città - EDITABILE */}
                    <EditableCell
                      rowId={r.id}
                      field="city"
                      value={r.city}
                      editingCell={editingCell}
                      tempValue={tempValue}
                      onStartEdit={startEditing}
                      onCancel={cancelEditing}
                      onSave={saveEditing}
                      onTempChange={setTempValue}
                    />
                    
                    {/* Tipo Locale - EDITABILE */}
                    <EditableCell
                      rowId={r.id}
                      field="tipo_locale"
                      value={r.tipo_locale}
                      editingCell={editingCell}
                      tempValue={tempValue}
                      onStartEdit={startEditing}
                      onCancel={cancelEditing}
                      onSave={saveEditing}
                      onTempChange={setTempValue}
                      options={TIPO_LOCALE}
                    />
                    
                    {/* Email - EDITABILE */}
                    <EditableCell
                      rowId={r.id}
                      field="email"
                      value={r.email}
                      editingCell={editingCell}
                      tempValue={tempValue}
                      onStartEdit={startEditing}
                      onCancel={cancelEditing}
                      onSave={saveEditing}
                      onTempChange={setTempValue}
                    />
                    
                    {/* Telefono - EDITABILE */}
                    <EditableCell
                      rowId={r.id}
                      field="phone"
                      value={r.phone}
                      editingCell={editingCell}
                      tempValue={tempValue}
                      onStartEdit={startEditing}
                      onCancel={cancelEditing}
                      onSave={saveEditing}
                      onTempChange={setTempValue}
                    />
                    
                    {/* P.IVA - NON EDITABILE */}
                    <td className="px-3 py-2 bg-gray-100">{r.vat_number || "—"}</td>
                    
                    {/* Data - NON EDITABILE */}
                    <td className="px-3 py-2 bg-gray-100">{new Date(r.created_at).toLocaleString()}</td>
                    
                    {/* Note - EDITABILE */}
                    <EditableCell
                      rowId={r.id}
                      field="notes"
                      value={r.notes}
                      editingCell={editingCell}
                      tempValue={tempValue}
                      onStartEdit={startEditing}
                      onCancel={cancelEditing}
                      onSave={saveEditing}
                      onTempChange={setTempValue}
                    />
                    
                    {/* Azioni - CANCELLAZIONE */}
                    <td className="px-3 py-2">
                      <button
                        onClick={() => openDeleteModal(r.id, r.name)}
                        className="text-red-600 hover:text-red-800"
                        title="Elimina cliente"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
                
                {!loading && actuallyReady && view.length === 0 && (
                  <tr>
                    <td className="px-3 py-8 text-center text-gray-500" colSpan={10}>
                      Nessun cliente trovato.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {loading && <div className="text-sm text-gray-500">Caricamento…</div>}
        </div>
      )}

      {/* Drawer con backdrop */}
      <DrawersWithBackdrop
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        rightContent={rightContent}
        onCloseLeft={closeLeft}
        onCloseRight={closeRight}
      />

      {/* 🆕 MODAL CONFERMA ELIMINAZIONE */}
      {deleteModal.open && (
        <div 
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
          onClick={closeDeleteModal}
        >
          <div 
            style={{
              background: 'white',
              borderRadius: 12,
              padding: 24,
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 20px 50px rgba(0,0,0,0.3)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 16 }}>⚠️</div>
            <h3 style={{ fontSize: 18, fontWeight: 600, textAlign: 'center', marginBottom: 8 }}>
              Eliminare questo cliente?
            </h3>
            <p style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 8 }}>
              Stai per eliminare:
            </p>
            <p style={{ fontSize: 16, fontWeight: 600, textAlign: 'center', marginBottom: 16, color: '#111827' }}>
              {deleteModal.clientName || 'Cliente senza nome'}
            </p>
            <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', marginBottom: 24 }}>
              ⚠️ Questa azione è irreversibile. Tutti i dati del cliente verranno persi.
            </p>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={closeDeleteModal}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: '1px solid #d1d5db',
                  background: 'white',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Annulla
              </button>
              <button
                onClick={confirmDelete}
                style={{
                  flex: 1,
                  padding: '12px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#dc2626',
                  color: 'white',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                🗑️ Elimina
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );

  }

function Th({ label, k, sortBy, sortDir, onClick }: { label: string; k: SortKey; sortBy: SortKey; sortDir: "asc" | "desc"; onClick: (k: SortKey) => void }) {
  const active = sortBy === k;
  return (
    <th className="px-3 py-2 text-left cursor-pointer select-none" onClick={() => onClick(k)}>
      <span className={active ? "font-semibold" : ""}>{label}</span>
      {active ? <span> {sortDir === "asc" ? "▲" : "▼"}</span> : null}
    </th>
  );
}

function EditableCell({
  rowId,
  field,
  value,
  editingCell,
  tempValue,
  onStartEdit,
  onCancel,
  onSave,
  onTempChange,
  options
}: {
  rowId: string;
  field: string;
  value: string;
  editingCell: {rowId: string, field: string} | null;
  tempValue: string;
  onStartEdit: (rowId: string, field: string, value: string) => void;
  onCancel: () => void;
  onSave: () => void;
  onTempChange: (value: string) => void;
  options?: string[];
}) {
  const isEditing = editingCell?.rowId === rowId && editingCell?.field === field;
  
  // 🔧 FIX UX: Bottoni di conferma/annulla invece di salvataggio automatico su blur
  if (isEditing) {
    const hasChanged = tempValue !== value;
    
    if (options && options.length > 0) {
      return (
        <td className="px-3 py-2">
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <select
              value={tempValue}
              onChange={(e) => onTempChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hasChanged) onSave();
                if (e.key === "Escape") onCancel();
              }}
              autoFocus
              className="flex-1 px-2 py-1 border rounded"
              style={{ minWidth: 100 }}
            >
              <option value="">Seleziona...</option>
              {options.map(opt => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
            <button
              onClick={onSave}
              disabled={!hasChanged}
              title="Conferma modifica"
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: hasChanged ? '#10b981' : '#d1d5db',
                color: 'white',
                cursor: hasChanged ? 'pointer' : 'not-allowed',
                fontSize: 14,
              }}
            >
              ✓
            </button>
            <button
              onClick={onCancel}
              title="Annulla"
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                border: 'none',
                background: '#ef4444',
                color: 'white',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              ✕
            </button>
          </div>
        </td>
      );
    }
    
    return (
      <td className="px-3 py-2">
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            type="text"
            value={tempValue}
            onChange={(e) => onTempChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hasChanged) onSave();
              if (e.key === "Escape") onCancel();
            }}
            autoFocus
            className="flex-1 px-2 py-1 border rounded"
            style={{ minWidth: 80 }}
          />
          <button
            onClick={onSave}
            disabled={!hasChanged}
            title="Conferma modifica"
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: 'none',
              background: hasChanged ? '#10b981' : '#d1d5db',
              color: 'white',
              cursor: hasChanged ? 'pointer' : 'not-allowed',
              fontSize: 14,
            }}
          >
            ✓
          </button>
          <button
            onClick={onCancel}
            title="Annulla"
            style={{
              padding: '4px 8px',
              borderRadius: 4,
              border: 'none',
              background: '#ef4444',
              color: 'white',
              cursor: 'pointer',
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
      </td>
    );
  }
  
  return (
    <td 
      className="px-3 py-2 cursor-pointer hover:bg-blue-50"
      onClick={() => onStartEdit(rowId, field, value)}
      title="Clicca per modificare"
    >
      {value || "—"}
    </td>
  );
}
