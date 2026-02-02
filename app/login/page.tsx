"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase/client"; // <- singleton
import { useRouter } from "next/navigation";
import { useCrypto } from "@/lib/crypto/CryptoProvider"; // ✅ 1. Import useCrypto
import Link from "next/link";

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  
  // ✅ 2. Ottieni la funzione di sblocco
  const { unlock } = useCrypto(); 

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // ⬇️ nuovi campi per il signup
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // ⬇️ Token Beta per registrazione su invito
  const [betaToken, setBetaToken] = useState("");
  const [tokenValidated, setTokenValidated] = useState(false);
  const [validatingToken, setValidatingToken] = useState(false);

  // ⬇️ consensi GDPR per il signup
  const [tosAccepted, setTosAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [marketingAccepted, setMarketingAccepted] = useState(false);

  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  // Funzione per validare il token beta
  async function validateBetaToken() {
    if (!betaToken.trim()) {
      setMsg("Inserisci un codice invito");
      return;
    }
    
    setValidatingToken(true);
    setMsg(null);
    
    try {
      const res = await fetch("/api/beta-tokens/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: betaToken.trim() }),
      });
      
      const data = await res.json();
      
      if (data.valid) {
        setTokenValidated(true);
        setMsg(null);
      } else {
        setMsg("Codice invito non valido o già utilizzato");
        setTokenValidated(false);
      }
    } catch (err) {
      setMsg("Errore nella verifica del codice");
      setTokenValidated(false);
    } finally {
      setValidatingToken(false);
    }
  }

  // 🗑️ Rimuovi la vecchia funzione savePassphrase
  // La sua logica è stata integrata (e corretta) direttamente in submit().

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    setLoading(true);
    let successSession = false; // Flag per tracciare se il login/signup ha creato una sessione valida

    try {
      if (mode === "signup") {
        // 0) Verifica token beta
        if (!tokenValidated) {
          setMsg("Devi validare il codice invito per registrarti.");
          setLoading(false);
          return;
        }

        // 0.1) Verifica consensi obbligatori
        if (!tosAccepted || !privacyAccepted) {
          setMsg("Devi accettare i Termini di Servizio e la Privacy Policy per registrarti.");
          setLoading(false);
          return;
        }

        // 1) Registrazione
        const { data, error } = await supabase.auth.signUp({ 
            email, 
            password, 
            options: { data: { first_name: firstName, last_name: lastName } } 
        });
        if (error) throw error;

        // 1.1) Usa il token beta (lo marca come usato)
        if (data.user) {
          try {
            await fetch("/api/beta-tokens/use", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                token: betaToken.trim(),
                userId: data.user.id,
              }),
            });
          } catch (tokenErr) {
            console.warn("[Login] Errore uso token beta:", tokenErr);
          }
        }

        // 1.2) Registra i consensi GDPR
        if (data.user) {
          try {
            await fetch("/api/consents/check-signup", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                user_id: data.user.id,
                tos_accepted: tosAccepted,
                privacy_accepted: privacyAccepted,
                marketing_accepted: marketingAccepted,
              }),
            });
          } catch (consentErr) {
            console.warn("[Login] Errore salvataggio consensi:", consentErr);
            // Non blocchiamo il signup per errori di logging
          }
        }

        // 2) Se sessione immediata (impostazioni Supabase)
        if (data.session) {
          successSession = true;
        } else {
          // Altrimenti tentiamo login immediato (se conferma email non è obbligatoria)
          const { data: si, error: siErr } = await supabase.auth.signInWithPassword({ email, password });
          if (siErr || !si.session) {
            setRegistrationSuccess(true);
            setLoading(false);
            return; // senza sessione non possiamo procedere
          }
          successSession = true;
        }

        // 3) Upsert profilo (richiede sessione attiva)
        const { data: sessCheck } = await supabase.auth.getSession();
        if (!sessCheck.session) throw new Error("Sessione assente dopo registrazione");

        const fn = firstName.trim();
        const ln = lastName.trim();
        if (!fn || !ln) throw new Error("Inserisci nome e cognome per completare la registrazione.");

        const { error: upsertErr } = await supabase
          .from("profiles")
          .upsert({ id: sessCheck.session.user.id, first_name: fn, last_name: ln }, { onConflict: "id" });
        if (upsertErr) throw upsertErr;
        
      } else {
        // Accesso (Sign In)
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        successSession = !!data.session;
      }

      // ----------------------------------------------------
      // ➡️ AZIONI CRUCIALI DOPO LOGIN/SIGNUP DI SUCCESSO
      // ----------------------------------------------------
      if (successSession) {
        
        // ⬇️ allinea i cookie lato server (scrive i cookie sb-*)
        const { data: sess } = await supabase.auth.getSession();
        if (!sess.session) throw new Error("Sessione assente dopo login/signup");

        await fetch("/api/auth/sync", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            access_token: sess.session.access_token,
            refresh_token: sess.session.refresh_token,
          }),
          credentials: "same-origin",
        });

        // ✅ 3. Sblocca la cifratura (Passphrase = PW)
        try {
          console.log('[Login] Tentativo di sblocco crittografia con la password...');
          await unlock(password); 
          console.log('[Login] ✅ Unlock completato');
        } catch (cryptoError) {
          console.error('[Login] Unlock fallito (chiavi/passphrase errata):', cryptoError);
          // Non blocchiamo il redirect qui. L'app riproverà in automatico.
        }
        
        // ✅ 4. Memorizza la Passphrase in ENTRAMBI gli storage (più robusto)
        // Salva PRIMA del redirect per garantire che sia scritto
        try {
          // Salva in localStorage PRIMA (più persistente)
          localStorage.setItem("repping:pph", password);
          // Poi in sessionStorage
          sessionStorage.setItem("repping:pph", password);
          
          // 🔧 FIX: Verifica che sia stato salvato (Android può fallire silenziosamente)
          const verifyLocal = localStorage.getItem("repping:pph");
          const verifySession = sessionStorage.getItem("repping:pph");
          
          if (verifyLocal !== password || verifySession !== password) {
            console.warn('[Login] ⚠️ Storage verification failed, retrying...');
            // Retry con flush esplicito
            localStorage.setItem("repping:pph", password);
            sessionStorage.setItem("repping:pph", password);
          }
          
          console.log('[Login] ✅ Passphrase salvata e verificata in storage');
        } catch (storageError) {
          console.error('[Login] ❌ Errore salvataggio storage:', storageError);
          // Non blocchiamo, ma loggiamo l'errore
        }
        
        // ✅ 5. Delay aumentato per Android (300ms invece di 100ms)
        // Alcuni browser Android hanno bisogno di più tempo per scrivere nello storage
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // ✅ 6. Verifica finale prima del redirect
        const finalCheck = localStorage.getItem("repping:pph");
        if (finalCheck !== password) {
          console.error('[Login] ❌ CRITICO: Passphrase non persistita dopo delay!');
          // Salva di nuovo come ultimo tentativo
          try {
            localStorage.setItem("repping:pph", password);
            sessionStorage.setItem("repping:pph", password);
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (e) {
            console.error('[Login] ❌ Fallito anche il retry finale');
          }
        }
        
        // ✅ 7. Controllo ruolo per redirect intelligente
        let redirectPath = "/"; // Default: home
        
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', user.id)
              .single();
            
            // Admin → Dashboard Admin
            if (profile?.role === 'admin') {
              console.log('[Login] 👑 Admin rilevato, redirect a /admin');
              redirectPath = "/admin";
            }
          }
        } catch (roleError) {
          console.warn('[Login] Errore verifica ruolo, redirect a home:', roleError);
        }
        
        // redirect "hard"
        window.location.replace(redirectPath);

      } else {
        // Questo ramo gestisce il caso di signup dove è richiesta conferma email
        setRegistrationSuccess(true);
      }

    } catch (err: any) {
      console.error("[Login] Global error:", err);
      setMsg(err?.message ?? "Errore.");
      // ✅ fallback di sicurezza: rimuovi la pass (se fallisce)
      try { sessionStorage.removeItem("repping:pph"); localStorage.removeItem("repping:pph"); } catch {}
    } finally {
      setLoading(false);
    }
  }

  // Se registrazione riuscita, mostra solo il messaggio
  if (registrationSuccess) {
    return (
      <div className="container" style={{ maxWidth: 440, paddingTop: 64, textAlign: "center" }}>
        <div style={{ 
          background: "#FEF3C7", 
          border: "2px solid #F59E0B", 
          borderRadius: 16, 
          padding: 32,
          marginTop: 48 
        }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 style={{ color: "#92400E", fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
            Registrazione riuscita!
          </h2>
          <p style={{ color: "#B45309", fontSize: 16, lineHeight: 1.6 }}>
            Controlla l'email per confermare l'account, poi accedi.
          </p>
        </div>
        <button
          type="button"
          className="btn"
          style={{ marginTop: 24 }}
          onClick={() => {
            setRegistrationSuccess(false);
            setMode("signin");
          }}
        >
          Vai al Login
        </button>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: 440, paddingTop: 64 }}>
      <h1 className="title">{mode === "signin" ? "Accedi" : "Registrati"}</h1>
      <p className="helper">REPING Beta V2 - Per Utenti Tester - SU INVITO o RICHIESTA</p>

      <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
        {/* Token Beta - richiesto per la registrazione */}
        {mode === "signup" && (
          <div style={{ 
            padding: 16, 
            background: tokenValidated ? "#0D2818" : "#0B1220", 
            borderRadius: 12, 
            border: tokenValidated ? "2px solid #22C55E" : "1px solid #1F2937",
            transition: "all 0.3s ease"
          }}>
            <label style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 8, display: "block" }}>
              🎟️ Codice Invito Beta
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                placeholder="BETA-XXXXXXXX"
                value={betaToken}
                onChange={(e) => {
                  setBetaToken(e.target.value.toUpperCase());
                  setTokenValidated(false); // Reset validazione se cambia
                }}
                disabled={tokenValidated}
                style={{
                  flex: 1,
                  padding: 10, 
                  border: "1px solid #1F2937", 
                  borderRadius: 10,
                  background: tokenValidated ? "#0D2818" : "#0B1220", 
                  color: tokenValidated ? "#22C55E" : "#C9D1E7",
                  fontFamily: "monospace",
                  textTransform: "uppercase"
                }}
              />
              {!tokenValidated && (
                <button
                  type="button"
                  onClick={validateBetaToken}
                  disabled={validatingToken || !betaToken.trim()}
                  style={{
                    padding: "10px 16px",
                    background: "#3B82F6",
                    color: "white",
                    border: "none",
                    borderRadius: 10,
                    cursor: validatingToken ? "wait" : "pointer",
                    opacity: validatingToken || !betaToken.trim() ? 0.5 : 1
                  }}
                >
                  {validatingToken ? "..." : "Verifica"}
                </button>
              )}
            </div>
            {tokenValidated && (
              <p style={{ color: "#22C55E", fontSize: 12, marginTop: 8 }}>
                ✅ Codice valido! Completa la registrazione.
              </p>
            )}
          </div>
        )}

        {/* Campi signup - visibili solo se token validato */}
        {mode === "signup" && tokenValidated && (
          <>
            <input
              name="firstName" id="firstName" autoComplete="given-name"
              type="text"
              placeholder="Nome"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
              style={{
                padding: 10, border: "1px solid #1F2937", borderRadius: 10,
                background: "#0B1220", color: "#C9D1E7"
              }}
            />
            <input
              name="lastName" id="lastName" autoComplete="family-name"
              type="text"
              placeholder="Cognome"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              required
              style={{
                padding: 10, border: "1px solid #1F2937", borderRadius: 10,
                background: "#0B1220", color: "#C9D1E7"
              }}
            />
          </>
        )}

        {/* Email e Password - per signin sempre, per signup solo dopo token validato */}
        {(mode === "signin" || tokenValidated) && (
          <>
            <input
              name="email" id="email" autoComplete="username"
              type="email"
              placeholder="la-tua-email@esempio.it"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{
                padding: 10, border: "1px solid #1F2937", borderRadius: 10,
                background: "#0B1220", color: "#C9D1E7"
              }}
            />
            <input
              name="password" id="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              type="password"
              placeholder="password (min 6)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              style={{
                padding: 10, border: "1px solid #1F2937", borderRadius: 10,
                background: "#0B1220", color: "#C9D1E7"
              }}
            />
          </>
        )}

        {/* Consensi GDPR - solo in modalità signup dopo token validato */}
        {mode === "signup" && tokenValidated && (
          <div style={{ 
            display: "flex", 
            flexDirection: "column", 
            gap: 8, 
            padding: 12, 
            background: "#0B1220", 
            borderRadius: 10, 
            border: "1px solid #1F2937",
            marginTop: 4 
          }}>
            <p style={{ color: "#9CA3AF", fontSize: 12, marginBottom: 4 }}>
              Per registrarti, accetta i seguenti consensi:
            </p>
            
            {/* ToS - Obbligatorio */}
            <label style={{ 
              display: "flex", 
              alignItems: "flex-start", 
              gap: 8, 
              cursor: "pointer",
              color: "#C9D1E7",
              fontSize: 13
            }}>
              <input
                type="checkbox"
                checked={tosAccepted}
                onChange={(e) => setTosAccepted(e.target.checked)}
                style={{ marginTop: 2, accentColor: "#3B82F6" }}
              />
              <span>
                Ho letto e accetto i{" "}
                <Link href="/legal/terms" target="_blank" style={{ color: "#3B82F6", textDecoration: "underline" }}>
                  Termini di Servizio
                </Link>
                <span style={{ color: "#EF4444" }}> *</span>
              </span>
            </label>

            {/* Privacy - Obbligatorio */}
            <label style={{ 
              display: "flex", 
              alignItems: "flex-start", 
              gap: 8, 
              cursor: "pointer",
              color: "#C9D1E7",
              fontSize: 13
            }}>
              <input
                type="checkbox"
                checked={privacyAccepted}
                onChange={(e) => setPrivacyAccepted(e.target.checked)}
                style={{ marginTop: 2, accentColor: "#3B82F6" }}
              />
              <span>
                Ho letto la{" "}
                <Link href="/legal/privacy" target="_blank" style={{ color: "#3B82F6", textDecoration: "underline" }}>
                  Privacy Policy
                </Link>
                <span style={{ color: "#EF4444" }}> *</span>
              </span>
            </label>

            {/* Marketing - Opzionale */}
            <label style={{ 
              display: "flex", 
              alignItems: "flex-start", 
              gap: 8, 
              cursor: "pointer",
              color: "#C9D1E7",
              fontSize: 13
            }}>
              <input
                type="checkbox"
                checked={marketingAccepted}
                onChange={(e) => setMarketingAccepted(e.target.checked)}
                style={{ marginTop: 2, accentColor: "#3B82F6" }}
              />
              <span>
                Acconsento a ricevere comunicazioni marketing
                <span style={{ color: "#9CA3AF", fontSize: 11 }}> (opzionale)</span>
              </span>
            </label>

            <p style={{ color: "#9CA3AF", fontSize: 11, marginTop: 4 }}>
              <span style={{ color: "#EF4444" }}>*</span> Campi obbligatori
            </p>
          </div>
        )}

        {/* Bottone submit - per signin sempre visibile, per signup solo dopo token */}
        {(mode === "signin" || tokenValidated) && (
          <button 
            className="btn" 
            type="submit" 
            disabled={loading || (mode === "signup" && (!tosAccepted || !privacyAccepted))}
          >
            {loading ? "Attendere…" : mode === "signin" ? "Accedi" : "Registrati"}
          </button>
        )}

        <button
          type="button"
          className="iconbtn"
          onClick={() => setMode(m => m === "signin" ? "signup" : "signin")}
          disabled={loading}
        >
          {mode === "signin" ? "Passa a Registrazione" : "Hai già un account? Accedi"}
        </button>

        {msg && <p style={{ color: "#F59E0B" }}>{msg}</p>}
      </form>

      {/* Link CoPilot */}
      <div style={{ marginTop: 32, textAlign: "center" }}>
        <a 
          href="https://reping.it" 
          target="_blank"
          rel="noopener noreferrer"
          className="helper"
          style={{ 
            textDecoration: "none",
            color: "#9CA3AF",
            fontSize: 13,
          }}
        >
          REPING - CoPilot AI per agenti di commercio
        </a>
      </div>
    </div>
  );
}
