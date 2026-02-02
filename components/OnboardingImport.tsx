"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { parse } from "csv-parse/browser/esm/sync";
import readXlsxFile from "read-excel-file";
import { supabase } from "@/lib/supabase/client";

const ONBOARDING_KEY = "reping:onboarding_import_done";
const WELCOME_SHOWN_KEY = "reping:welcome_shown";

interface OnboardingImportProps {
  userName: string;
}

type OnboardingStep = "intro" | "uploading" | "analyzing" | "preview" | "importing" | "done";

interface AnalysisResult {
  mapping: Record<string, string>;
  sampleData: Record<string, string>[];
  totalRows: number;
  validRows: number;
  issues: string[];
}

export default function OnboardingImport({ userName }: OnboardingImportProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [show, setShow] = useState(false);
  const [step, setStep] = useState<OnboardingStep>("intro");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  // Stato per il popup dei dati fake
  const [showFakeDataPopup, setShowFakeDataPopup] = useState(false);
  const [loadingFakeData, setLoadingFakeData] = useState(false);
  const [showTourPrompt, setShowTourPrompt] = useState(false);
  
  // Mostra solo se welcome è già stato mostrato e onboarding non completato
  useEffect(() => {
    const checkShow = () => {
      const welcomeShown = localStorage.getItem(WELCOME_SHOWN_KEY);
      const onboardingDone = localStorage.getItem(ONBOARDING_KEY);
      
      console.log('[OnboardingImport] checkShow:', { welcomeShown: !!welcomeShown, onboardingDone: !!onboardingDone });
      
      if (welcomeShown && !onboardingDone) {
        console.log('[OnboardingImport] ✅ Mostro OnboardingImport');
        // Piccolo delay per transizione fluida
        setTimeout(() => setShow(true), 300);
      }
    };
    
    // Check iniziale (con piccolo delay per aspettare il render)
    setTimeout(checkShow, 100);
    
    // Ascolta quando il welcome viene chiuso (custom event)
    const handleWelcomeClosed = () => {
      console.log('[OnboardingImport] 📣 Ricevuto evento welcomeClosed');
      setTimeout(checkShow, 100);
    };
    
    window.addEventListener("reping:welcomeClosed", handleWelcomeClosed);
    window.addEventListener("storage", checkShow); // Per altre tab
    
    return () => {
      window.removeEventListener("reping:welcomeClosed", handleWelcomeClosed);
      window.removeEventListener("storage", checkShow);
    };
  }, []);

  const firstName = userName.split(" ")[0] || "Agente";

  // Quando l'utente clicca "Lista non ancora pronta"
  const handleSkipToFakePopup = () => {
    setShowFakeDataPopup(true);
  };

  // Carica dati fake
  const handleLoadFakeData = async () => {
    setLoadingFakeData(true);
    try {
      // Ottieni userId dell'utente loggato
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("Utente non autenticato");
      }
      
      const response = await fetch("/api/demo/seed", { 
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const result = await response.json();
      
      console.log("[OnboardingImport] Demo seed result:", result);
      
      if (!response.ok || !result.success) {
        const errorMsg = result.error || "Errore caricamento dati demo";
        const details = result.details ? `\n\nDettagli:\n${result.details.join("\n")}` : "";
        throw new Error(errorMsg + details);
      }
      
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ 
        usedDemo: true, 
        at: new Date().toISOString() 
      }));
      
      setShowFakeDataPopup(false);
      setShow(false);
      
      // Mostra popup per tour guidato invece di reload diretto
      setShowTourPrompt(true);
      
    } catch (err: any) {
      console.error("[OnboardingImport] Error loading fake data:", err);
      alert("Errore: " + err.message);
    } finally {
      setLoadingFakeData(false);
    }
  };

  // Skip definitivo senza dati fake
  const handleSkipCompletely = () => {
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ 
      skipped: true, 
      at: new Date().toISOString() 
    }));
    setShowFakeDataPopup(false);
    setShow(false);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setStep("uploading");
    setError(null);
    
    try {
      // 1. Parse file
      setProgress(20);
      const { headers, data } = await parseFile(selectedFile);
      
      if (data.length === 0) {
        throw new Error("Il file sembra vuoto. Controlla che contenga dati.");
      }
      
      // Salva i dati raw per passarli alla pagina import
      setRawFileData({ headers, data });
      
      setStep("analyzing");
      setProgress(40);
      
      // 2. AI Analysis per mapping colonne
      const result = await analyzeWithAI(headers, data);
      
      setProgress(100);
      setAnalysis(result);
      setStep("preview");
      
    } catch (err: any) {
      console.error("Errore parsing:", err);
      setError(err.message || "Errore durante l'analisi del file");
      setStep("intro");
    }
  };

  const parseFile = async (file: File): Promise<{ headers: string[]; data: any[] }> => {
    const extension = file.name.toLowerCase().split(".").pop();
    
    if (extension === "csv") {
      const text = await file.text();
      const records = parse(text, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true, // Tollera righe con colonne in più/meno
      });
      
      if (records.length === 0) throw new Error("File CSV vuoto");
      return { headers: Object.keys(records[0]), data: records };
      
    } else if (extension === "xlsx" || extension === "xls") {
      const rows = await readXlsxFile(file);
      if (!rows || rows.length < 2) throw new Error("File Excel vuoto o senza dati");
      
      const headers = rows[0].map((cell) => String(cell || "").trim());
      const data = rows.slice(1).map((row) => {
        const obj: Record<string, any> = {};
        headers.forEach((header, i) => {
          obj[header] = row[i] !== null && row[i] !== undefined ? row[i] : "";
        });
        return obj;
      });
      
      return { headers, data };
    }
    
    throw new Error(`Formato non supportato: ${extension}. Usa CSV o Excel.`);
  };

  const analyzeWithAI = async (
    headers: string[], 
    data: any[]
  ): Promise<AnalysisResult> => {
    // Prendi sample dei primi 5 record
    const sampleData = data.slice(0, 5);
    
    try {
      // Chiama API per AI mapping
      const response = await fetch("/api/clients/analyze-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ headers, sampleData }),
      });
      
      if (!response.ok) {
        throw new Error("Errore nell'analisi AI");
      }
      
      const result = await response.json();
      
      // Conta righe valide (quelle che hanno almeno un name)
      const nameCol = Object.entries(result.mapping).find(([_, v]) => v === "name")?.[0];
      const validRows = nameCol 
        ? data.filter(row => row[nameCol] && String(row[nameCol]).trim()).length
        : 0;
      
      return {
        mapping: result.mapping,
        sampleData,
        totalRows: data.length,
        validRows,
        issues: result.issues || [],
      };
      
    } catch (err) {
      // Fallback: usa mapping basico se AI non disponibile
      console.warn("AI mapping fallback:", err);
      return fallbackMapping(headers, data);
    }
  };

  const fallbackMapping = (headers: string[], data: any[]): AnalysisResult => {
    const ALIASES: Record<string, string[]> = {
      name: ["name", "nome", "ragione sociale", "azienda", "cliente", "company", "rag.soc", "rag soc"],
      contact_name: ["contact_name", "contatto", "referente", "rif", "rif.to", "riferimento"],
      phone: ["phone", "telefono", "tel", "mobile", "cell", "cellulare"],
      email: ["email", "mail", "e-mail", "posta"],
      address: ["address", "indirizzo", "via", "street"],
      city: ["city", "città", "citta", "comune", "località"],
      notes: ["notes", "note", "commenti", "memo"],
    };
    
    const mapping: Record<string, string> = {};
    
    for (const header of headers) {
      const norm = header.toLowerCase().trim();
      for (const [field, aliases] of Object.entries(ALIASES)) {
        if (aliases.some(a => norm.includes(a) || a.includes(norm))) {
          mapping[header] = field;
          break;
        }
      }
    }
    
    const nameCol = Object.entries(mapping).find(([_, v]) => v === "name")?.[0];
    const validRows = nameCol 
      ? data.filter(row => row[nameCol] && String(row[nameCol]).trim()).length
      : 0;
    
    return {
      mapping,
      sampleData: data.slice(0, 5),
      totalRows: data.length,
      validRows,
      issues: validRows === 0 ? ["Non ho trovato una colonna con i nomi dei clienti"] : [],
    };
  };

  // Stato per salvare i dati raw del file
  const [rawFileData, setRawFileData] = useState<{ headers: string[]; data: any[] } | null>(null);

  const handleProceed = () => {
    // Salva TUTTI i dati per la pagina import
    if (rawFileData && analysis) {
      sessionStorage.setItem("reping:import_prefilled", JSON.stringify({
        headers: rawFileData.headers,
        data: rawFileData.data,
        mapping: analysis.mapping,
        fileName: file?.name,
      }));
    }
    
    localStorage.setItem(ONBOARDING_KEY, JSON.stringify({ 
      completed: true,
      at: new Date().toISOString() 
    }));
    
    router.push("/tools/import-clients?from=onboarding");
  };

  if (!show) return null;

  return (
    <div 
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4"
      style={{ background: "rgba(0, 0, 0, 0.8)" }}
    >
      <div 
        className="bg-white rounded-2xl max-w-lg w-full overflow-hidden shadow-2xl"
        style={{ animation: "fadeInScale 0.3s ease-out" }}
      >
        {/* Header */}
        <div 
          className="px-6 py-6 text-white"
          style={{ 
            background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)" 
          }}
        >
          <div className="flex items-center gap-3">
            <span className="text-4xl">📋</span>
            <div>
              <h1 className="text-xl font-bold">
                Ciao {firstName}, iniziamo!
              </h1>
              <p className="text-blue-100 text-sm">
                Importazione automatica clienti
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6">
          
          {/* STEP: INTRO */}
          {step === "intro" && (
            <div className="space-y-4">
              <p className="text-slate-700 text-base leading-relaxed">
                Per prima cosa ti propongo l'<strong>importazione automatica</strong> dei tuoi clienti.
              </p>
              
              <p className="text-slate-600 text-sm leading-relaxed">
                Se puoi, carica la lista clienti in formato <strong>Excel</strong> o <strong>CSV</strong>.
                <br />
                Altrimenti carica quello che hai: <span className="text-blue-600 font-medium">vediamo cosa si può fare!</span>
              </p>
              
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
                  ⚠️ {error}
                </div>
              )}
              
              {/* Upload area */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-blue-300 bg-blue-50 rounded-xl p-8 text-center cursor-pointer hover:bg-blue-100 hover:border-blue-400 transition-colors"
              >
                <div className="text-5xl mb-3">📂</div>
                <p className="font-semibold text-slate-800">
                  Carica file Excel o CSV
                </p>
                <p className="text-sm text-slate-500 mt-1">
                  Clicca qui o trascina il file
                </p>
              </div>
              
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          )}
          
          {/* STEP: UPLOADING / ANALYZING */}
          {(step === "uploading" || step === "analyzing") && (
            <div className="text-center py-8">
              <div className="text-5xl mb-4 animate-bounce">
                {step === "uploading" ? "📤" : "🤖"}
              </div>
              <p className="font-semibold text-slate-800 mb-2">
                {step === "uploading" ? "Caricamento file..." : "Analisi intelligente in corso..."}
              </p>
              <p className="text-sm text-slate-500 mb-4">
                {step === "analyzing" && "L'AI sta mappando le colonne automaticamente"}
              </p>
              
              <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}
          
          {/* STEP: PREVIEW */}
          {step === "preview" && analysis && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-blue-600">
                <span className="text-2xl">✅</span>
                <span className="font-semibold">Analisi completata!</span>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-slate-800">{analysis.totalRows}</div>
                  <div className="text-xs text-slate-500">Righe totali</div>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <div className="text-2xl font-bold text-blue-600">{analysis.validRows}</div>
                  <div className="text-xs text-blue-600">Clienti riconosciuti</div>
                </div>
              </div>
              
              {/* Mapping trovato */}
              <div className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs font-semibold text-slate-500 mb-2 uppercase">
                  Campi riconosciuti automaticamente:
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(analysis.mapping).map(([col, field]) => (
                    <span 
                      key={col}
                      className="px-2 py-1 bg-white border border-slate-200 rounded text-xs"
                    >
                      <span className="text-slate-500">{col}</span>
                      <span className="mx-1">→</span>
                      <span className="font-medium text-blue-600">{field}</span>
                    </span>
                  ))}
                </div>
              </div>
              
              {/* Issues */}
              {analysis.issues.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs font-semibold text-amber-700 mb-1">⚠️ Note:</p>
                  {analysis.issues.map((issue, i) => (
                    <p key={i} className="text-sm text-amber-800">{issue}</p>
                  ))}
                </div>
              )}
              
              <p className="text-sm text-slate-600">
                Prosegui per vedere l'anteprima completa e completare l'importazione.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex gap-3">
          {step === "intro" && (
            <>
              <button
                onClick={handleSkipToFakePopup}
                className="flex-1 py-3 rounded-xl border border-slate-300 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
              >
                Lista non ancora pronta
              </button>
            </>
          )}
          
          {step === "preview" && (
            <>
              <button
                onClick={() => { setStep("intro"); setFile(null); setAnalysis(null); }}
                className="px-4 py-3 rounded-xl border border-slate-300 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
              >
                ← Indietro
              </button>
              <button
                onClick={handleProceed}
                className="flex-1 py-3 rounded-xl text-white font-bold transition-transform hover:scale-[1.02] active:scale-[0.98]"
                style={{ 
                  background: "linear-gradient(135deg, #3b82f6 0%, #6366f1 100%)" 
                }}
              >
                Prosegui all'importazione →
              </button>
            </>
          )}
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeInScale {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>

      {/* ========== POPUP DATI FAKE ========== */}
      {showFakeDataPopup && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(0, 0, 0, 0.85)" }}
        >
          <div 
            className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl"
            style={{ animation: "fadeInScale 0.3s ease-out" }}
          >
            {/* Header */}
            <div 
              className="px-6 py-5 text-white"
              style={{ 
                background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" 
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-3xl">🧪</span>
                <div>
                  <h2 className="text-lg font-bold">Vuoi provare con dati demo?</h2>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="px-6 py-5">
              <p className="text-slate-700 text-sm leading-relaxed mb-4">
                Ricorda che sino a quando il database clienti non è popolato 
                non potrai testare molte delle funzionalità di REPING.
              </p>
              
              <p className="text-slate-600 text-sm leading-relaxed">
                Vuoi caricare un <strong>set temporaneo di dati fake</strong> (clienti, visite, note, storico) 
                per fare un po' di pratica con l'app?
              </p>
              
              <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <p className="text-amber-800 text-xs">
                  ⚠️ Quando poi deciderai di importare i tuoi clienti, questi dati demo 
                  verranno <strong>automaticamente cancellati</strong>.
                </p>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 pb-5 space-y-2">
              <button
                onClick={handleLoadFakeData}
                disabled={loadingFakeData}
                className="w-full py-3 rounded-xl text-white font-semibold transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
                style={{ 
                  background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)" 
                }}
              >
                {loadingFakeData ? "⏳ Caricamento..." : "✅ Sì, fammi provare con i dati demo"}
              </button>
              
              <button
                onClick={handleSkipCompletely}
                disabled={loadingFakeData}
                className="w-full py-3 rounded-xl border border-slate-300 text-slate-600 font-medium hover:bg-slate-50 transition-colors disabled:opacity-50"
              >
                No grazie, faccio un giro
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== POPUP TOUR PROMPT ========== */}
      {showTourPrompt && (
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
          style={{ background: "rgba(0, 0, 0, 0.85)" }}
        >
          <div 
            className="bg-white rounded-2xl max-w-md w-full overflow-hidden shadow-2xl"
            style={{ animation: "fadeInScale 0.3s ease-out" }}
          >
            {/* Header */}
            <div 
              className="px-6 py-8 text-center text-white"
              style={{ background: "linear-gradient(135deg, #10b981 0%, #059669 100%)" }}
            >
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-2xl font-bold mb-2">Perfetto!</h2>
              <p className="text-emerald-100">
                Ho caricato 10 clienti di prova con visite e note
              </p>
            </div>

            {/* Body */}
            <div className="px-6 py-6 text-center">
              <p className="text-slate-700 text-lg mb-2">
                Vuoi fare un <strong>giro veloce</strong>?
              </p>
              <p className="text-slate-500 text-sm">
                Ti mostro le 3 cose più importanti in 1 minuto
              </p>
            </div>

            {/* Footer */}
            <div className="px-6 pb-6 space-y-2">
              <button
                onClick={() => {
                  setShowTourPrompt(false);
                  // Trigger il tour guidato
                  window.dispatchEvent(new CustomEvent("reping:startTour"));
                }}
                className="w-full py-4 rounded-xl text-white font-bold text-lg transition-transform hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 100%)" }}
              >
                🚀 Sì, mostrami!
              </button>
              <button
                onClick={() => {
                  setShowTourPrompt(false);
                  window.location.reload();
                }}
                className="w-full py-3 rounded-xl border border-slate-300 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
              >
                Faccio da solo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper per resettare l'onboarding (utile per test)
export function resetOnboardingImport() {
  localStorage.removeItem(ONBOARDING_KEY);
}
