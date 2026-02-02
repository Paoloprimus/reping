/**
 * ============================================================================
 * PAGINA: Import Prodotti (CSV e Excel)
 * ============================================================================
 * 
 * PERCORSO: /app/tools/import-products/page.tsx
 * URL: https://reping.app/tools/import-products
 * 
 * DESCRIZIONE:
 * Pagina completa per l'importazione massiva di prodotti da file CSV e Excel.
 * Include 5 step: Upload → Mapping → Preview → Import → Report
 * 
 * FORMATI SUPPORTATI:
 * - CSV: Parsing con csv-parse
 * - XLSX/XLS: Parsing con libreria xlsx
 * 
 * FUNZIONALITÀ:
 * - Upload universale con drag & drop
 * - Riconoscimento automatico formato da estensione
 * - Auto-detection intelligente delle colonne
 * - Mapping manuale con dropdown
 * - Validazione campi obbligatori (codice, descrizione_articolo)
 * - Gestione duplicati per codice
 * - Progress bar durante parsing e import
 * - Report dettagliato finale
 * 
 * DIPENDENZE:
 * - csv-parse/browser/esm/sync (per CSV)
 * - read-excel-file (per Excel - libreria sicura)
 * - API /api/products/import-parsed
 * 
 * ============================================================================
 */

"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { parse } from "csv-parse/browser/esm/sync";
import readXlsxFile from "read-excel-file";
import { useDrawers, DrawersWithBackdrop } from "@/components/Drawers";
import TopBar from "@/components/home/TopBar";
import { supabase } from "@/lib/supabase/client";

type ProductRow = {
  codice?: string;
  descrizione_articolo?: string;
  title?: string;
  sku?: string;
  unita_misura?: string;
  giacenza?: string | number;
  base_price?: string | number;
  sconto_merce?: string;
  sconto_fattura?: string | number;
  is_active?: string | boolean;
};

type ProcessedProduct = ProductRow & {
  rowIndex: number;
  isValid: boolean;
  errors: string[];
};

type ImportStep = "upload" | "mapping" | "preview" | "importing" | "complete";

// Mapping: colonna CSV -> campo app
type ColumnMapping = Record<string, string | undefined>;

// Auto-detection intelligente delle colonne
const COLUMN_ALIASES: Record<string, string[]> = {
  codice: ["codice", "code", "cod", "item code", "product code", "articolo"],
  descrizione_articolo: ["descrizione_articolo", "descrizione", "description", "desc", "nome prodotto", "product name"],
  title: ["title", "titolo", "nome"],
  sku: ["sku", "barcode", "ean", "codice barre"],
  unita_misura: ["unita_misura", "um", "unità", "unit", "measure"],
  giacenza: ["giacenza", "stock", "qty", "quantità", "quantity", "disponibilità"],
  base_price: ["base_price", "prezzo", "price", "costo", "cost"],
  sconto_merce: ["sconto_merce", "sconto", "promo", "discount", "offerta"],
  sconto_fattura: ["sconto_fattura", "sconto %", "percentuale sconto", "discount %"],
  is_active: ["is_active", "attivo", "active", "stato", "status"],
};

export default function ImportProductsPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Drawer
  const { leftOpen, rightOpen, rightContent, openLeft, closeLeft, openDati, openDocs, openImpostazioni, closeRight } = useDrawers();
  
  // Logout
  async function logout() {
    try { sessionStorage.removeItem("repping:pph"); } catch {}
    try { localStorage.removeItem("repping:pph"); } catch {}
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
  
  const [step, setStep] = useState<ImportStep>("upload");
  const [rawData, setRawData] = useState<any[]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [processedProducts, setProcessedProducts] = useState<ProcessedProduct[]>([]);
  const [importProgress, setImportProgress] = useState(0);
  const [parsingProgress, setParsingProgress] = useState<string | null>(null);
  const [fileType, setFileType] = useState<string>("");
  const [importResults, setImportResults] = useState<{
    success: number;
    failed: number;
    duplicates: number;
    errors: string[];
  }>({ success: 0, failed: 0, duplicates: 0, errors: [] });

  // Auto-detect colonne
  const autoDetectMapping = (headers: string[]): ColumnMapping => {
    const detected: ColumnMapping = {};
    
    // Prima passata: match esatti
    for (const header of headers) {
      const normalized = header.toLowerCase().trim();
      
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (aliases.some(alias => normalized === alias)) {
          detected[header] = field;
          break;
        }
      }
    }
    
    // Seconda passata: match parziali
    for (const header of headers) {
      const normalized = header.toLowerCase().trim();
      
      for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
        if (detected[header]) continue;
        
        if (aliases.some(alias => normalized.includes(alias))) {
          detected[header] = field;
          break;
        }
      }
    }
    
    return detected;
  };

  // ==================== PARSER PER OGNI FORMATO ====================

  // Parser CSV
  async function parseCSV(file: File): Promise<{ headers: string[]; data: any[] }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      
      reader.onload = (event) => {
        try {
          const csvText = event.target?.result as string;
          const records = parse(csvText, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
          });

          if (records.length === 0) {
            reject(new Error("Il file CSV è vuoto!"));
            return;
          }

          const headers = Object.keys(records[0]);
          setParsingProgress(null);
          resolve({ headers, data: records });
        } catch (error: any) {
          setParsingProgress(null);
          reject(new Error(`Errore parsing CSV: ${error.message}`));
        }
      };

      reader.onerror = () => {
        setParsingProgress(null);
        reject(new Error("Errore lettura file CSV"));
      };

      reader.readAsText(file);
    });
  }

  // Parser Excel (usando read-excel-file - libreria sicura)
  async function parseExcel(file: File): Promise<{ headers: string[]; data: any[] }> {
    try {
      // read-excel-file restituisce un array di array (righe)
      const rows = await readXlsxFile(file);

      if (!rows || rows.length === 0) {
        throw new Error("Il file Excel è vuoto!");
      }

      // Prima riga = headers
      const headers = rows[0].map((cell) => String(cell || "").trim());
      
      // Righe successive = dati, convertite in oggetti JSON
      const jsonData = rows.slice(1).map((row) => {
        const obj: Record<string, any> = {};
        headers.forEach((header, index) => {
          // Gestisce valori null/undefined
          obj[header] = row[index] !== null && row[index] !== undefined ? row[index] : "";
        });
        return obj;
      });

          if (jsonData.length === 0) {
        throw new Error("Il file Excel non contiene dati (solo intestazioni)!");
          }

          setParsingProgress(null);
      return { headers, data: jsonData };
        } catch (error: any) {
          setParsingProgress(null);
      throw new Error(`Errore parsing Excel: ${error.message}`);
        }
  }

  // Gestione upload file
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Rileva estensione
    const fileName = file.name.toLowerCase();
    const extension = fileName.substring(fileName.lastIndexOf("."));
    
    setFileType(extension);
    setParsingProgress("Caricamento file...");

    try {
      let result: { headers: string[]; data: any[] };

      // Switch sul tipo di file
      if (extension === ".csv") {
        result = await parseCSV(file);
      } else if (extension === ".xlsx" || extension === ".xls") {
        result = await parseExcel(file);
      } else {
        throw new Error(`Formato file non supportato: ${extension}`);
      }

      // Salva headers e dati
      setCsvHeaders(result.headers);
      setRawData(result.data);

      // Auto-detect mapping
      const detected = autoDetectMapping(result.headers);
      setMapping(detected);

      // Vai a step mapping
      setStep("mapping");

    } catch (error: any) {
      alert(error.message);
      setParsingProgress(null);
    }
  };

  // Preview con validazione
  const handlePreview = () => {
    const processed: ProcessedProduct[] = [];

    for (let i = 0; i < rawData.length; i++) {
      const rawRow = rawData[i];
      const mappedRow: ProductRow = {};
      const errors: string[] = [];

      // Applica mapping
      for (const [csvCol, appField] of Object.entries(mapping)) {
        if (appField) {
          mappedRow[appField as keyof ProductRow] = rawRow[csvCol];
        }
      }

      // Validazione campi obbligatori
      if (!mappedRow.codice || String(mappedRow.codice).trim() === "") {
        errors.push("Codice mancante");
      }
      if (!mappedRow.descrizione_articolo || String(mappedRow.descrizione_articolo).trim() === "") {
        errors.push("Descrizione mancante");
      }

      // Validazione sconto_fattura (se presente)
      if (mappedRow.sconto_fattura !== undefined && mappedRow.sconto_fattura !== "") {
        const sconto = parseFloat(String(mappedRow.sconto_fattura));
        if (isNaN(sconto) || sconto < 0 || sconto > 100) {
          errors.push("Sconto fattura non valido (0-100)");
        }
      }

      processed.push({
        ...mappedRow,
        rowIndex: i + 1,
        isValid: errors.length === 0,
        errors,
      });
    }

    setProcessedProducts(processed);
    setStep("preview");
  };

  // Import finale
  const handleImport = async () => {
    setStep("importing");
    setImportProgress(0);
    
    const results = {
      success: 0,
      failed: 0,
      duplicates: 0,
      errors: [] as string[],
    };

    try {
      // Prepara array di prodotti validi
      const validProducts = processedProducts
        .filter(p => p.isValid)
        .map(p => ({
          codice: String(p.codice).trim(),
          descrizione_articolo: String(p.descrizione_articolo).trim(),
          title: p.title ? String(p.title).trim() : String(p.descrizione_articolo).trim(), // Usa descrizione se title manca
          sku: p.sku ? String(p.sku).trim() : undefined,
          unita_misura: p.unita_misura ? String(p.unita_misura).trim() : undefined,
          giacenza: p.giacenza !== undefined && p.giacenza !== null && p.giacenza !== "" ? parseInt(String(p.giacenza)) : 0,
          base_price: p.base_price !== undefined && p.base_price !== null && p.base_price !== "" ? parseFloat(String(p.base_price)) : undefined,
          sconto_merce: p.sconto_merce ? String(p.sconto_merce).trim() : undefined,
          sconto_fattura: p.sconto_fattura !== undefined && p.sconto_fattura !== null && p.sconto_fattura !== "" ? parseFloat(String(p.sconto_fattura)) : undefined,
          is_active: p.is_active !== undefined && p.is_active !== null && p.is_active !== "" ? Boolean(p.is_active) : true,
        }));

      if (validProducts.length === 0) {
        throw new Error("Nessun prodotto valido da importare");
      }

      setImportProgress(50);

      // Chiamata API
      const response = await fetch("/api/products/import-parsed", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          products: validProducts,
          overwrite: false, // Non sovrascrivere prodotti esistenti
        }),
      });

      setImportProgress(90);

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || "Errore import");
      }

      const data = await response.json();
      
      results.success = data.imported || 0;
      results.failed = data.failed || 0;
      results.duplicates = data.duplicatesDropped || 0;
      
      if (data.dbError) {
        results.errors.push(data.dbError);
      }

      setImportProgress(100);

    } catch (e: any) {
      console.error("Errore import:", e);
      results.errors.push(e.message);
    }

    setImportResults(results);
    setStep("complete");
  };

  // Reset e ritorna a upload
  const handleReset = () => {
    setStep("upload");
    setRawData([]);
    setCsvHeaders([]);
    setMapping({});
    setProcessedProducts([]);
    setImportProgress(0);
    setParsingProgress(null);
    setFileType("");
    setImportResults({ success: 0, failed: 0, duplicates: 0, errors: [] });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <TopBar
        title="Import Prodotti"
        onOpenLeft={openLeft}
        onOpenDati={openDati}
        onOpenDocs={openDocs}
        onOpenImpostazioni={openImpostazioni}
        onLogout={logout}
      />

      {/* Drawer con backdrop */}
      <DrawersWithBackdrop
        leftOpen={leftOpen}
        rightOpen={rightOpen}
        rightContent={rightContent}
        onCloseLeft={closeLeft}
        onCloseRight={closeRight}
      />

      <main className="container mx-auto px-4 py-8 max-w-6xl">
        {/* Progress Indicator */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-2">
            {["Upload", "Mapping", "Preview", "Import", "Report"].map((label, idx) => {
              const steps: ImportStep[] = ["upload", "mapping", "preview", "importing", "complete"];
              const currentIdx = steps.indexOf(step);
              const isActive = idx === currentIdx;
              const isComplete = idx < currentIdx;

              return (
                <div key={label} className="flex-1 text-center">
                  <div
                    className={`inline-block w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                      isActive
                        ? "bg-blue-500 text-white"
                        : isComplete
                        ? "bg-green-500 text-white"
                        : "bg-gray-300 text-gray-600"
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <div className="text-xs mt-1">{label}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* STEP 1: UPLOAD */}
        {step === "upload" && (
          <div className="bg-white rounded-lg shadow p-8">
            <h2 className="text-2xl font-bold mb-6">📤 Carica File Prodotti</h2>
            
            <div className="mb-6">
              <p className="text-gray-700 mb-4">
                Formati supportati: <strong>CSV</strong>, <strong>Excel (.xlsx, .xls)</strong>
              </p>
              
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                  id="file-upload"
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer inline-block px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
                >
                  Seleziona File
                </label>
                <p className="mt-4 text-gray-500 text-sm">
                  Oppure trascina il file qui
                </p>
              </div>
            </div>

            {parsingProgress && (
              <div className="mt-4 text-center text-blue-600 font-medium">
                {parsingProgress}
              </div>
            )}
          </div>
        )}

        {/* STEP 2: MAPPING */}
        {step === "mapping" && (
          <div className="bg-white rounded-lg shadow p-8">
            <h2 className="text-2xl font-bold mb-6">🔗 Mapping Colonne</h2>
            
            <p className="text-gray-700 mb-6">
              Associa le colonne del file ai campi dell'applicazione.
              <br />
              <span className="text-sm text-red-600">* Campi obbligatori: Codice, Descrizione</span>
            </p>

            <div className="space-y-3 mb-6">
              {csvHeaders.map((header) => (
                <div key={header} className="flex items-center gap-4">
                  <div className="w-1/3 font-medium text-gray-700">{header}</div>
                  <div className="w-1/3">
                    <select
                      value={mapping[header] || ""}
                      onChange={(e) => setMapping({ ...mapping, [header]: e.target.value || undefined })}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="">-- Non mappare --</option>
                      <option value="codice">Codice *</option>
                      <option value="descrizione_articolo">Descrizione *</option>
                      <option value="title">Titolo</option>
                      <option value="sku">SKU/Barcode</option>
                      <option value="unita_misura">Unità Misura</option>
                      <option value="giacenza">Giacenza</option>
                      <option value="base_price">Prezzo Base</option>
                      <option value="sconto_merce">Sconto Merce</option>
                      <option value="sconto_fattura">Sconto Fattura %</option>
                      <option value="is_active">Attivo</option>
                    </select>
                  </div>
                  <div className="w-1/3 text-sm text-gray-500">
                    {rawData[0]?.[header] || "-"}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleReset}
                className="px-6 py-2 border rounded hover:bg-gray-100"
              >
                ← Indietro
              </button>
              <button
                onClick={handlePreview}
                className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Avanti: Preview →
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: PREVIEW */}
        {step === "preview" && (
          <div className="bg-white rounded-lg shadow p-8">
            <h2 className="text-2xl font-bold mb-6">👁️ Preview Dati</h2>
            
            <div className="mb-6">
              <p className="text-gray-700">
                Totale righe: <strong>{processedProducts.length}</strong>
                <br />
                Valide: <strong className="text-green-600">{processedProducts.filter(p => p.isValid).length}</strong>
                <br />
                Con errori: <strong className="text-red-600">{processedProducts.filter(p => !p.isValid).length}</strong>
              </p>
            </div>

            <div className="overflow-x-auto mb-6" style={{ maxHeight: "400px" }}>
              <table className="w-full border-collapse border">
                <thead className="bg-gray-100 sticky top-0">
                  <tr>
                    <th className="border px-2 py-2 text-xs">#</th>
                    <th className="border px-2 py-2 text-xs">Codice</th>
                    <th className="border px-2 py-2 text-xs">Descrizione</th>
                    <th className="border px-2 py-2 text-xs">UM</th>
                    <th className="border px-2 py-2 text-xs">Prezzo</th>
                    <th className="border px-2 py-2 text-xs">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {processedProducts.map((prod) => (
                    <tr key={prod.rowIndex} className={prod.isValid ? "" : "bg-red-50"}>
                      <td className="border px-2 py-1 text-xs">{prod.rowIndex}</td>
                      <td className="border px-2 py-1 text-xs">{prod.codice || "-"}</td>
                      <td className="border px-2 py-1 text-xs">{prod.descrizione_articolo || "-"}</td>
                      <td className="border px-2 py-1 text-xs">{prod.unita_misura || "-"}</td>
                      <td className="border px-2 py-1 text-xs">{prod.base_price || "-"}</td>
                      <td className="border px-2 py-1 text-xs">
                        {prod.isValid ? (
                          <span className="text-green-600">✓</span>
                        ) : (
                          <span className="text-red-600 text-xs">{prod.errors.join(", ")}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex gap-4">
              <button
                onClick={() => setStep("mapping")}
                className="px-6 py-2 border rounded hover:bg-gray-100"
              >
                ← Indietro
              </button>
              <button
                onClick={handleImport}
                disabled={processedProducts.filter(p => p.isValid).length === 0}
                className="px-6 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:bg-gray-300"
              >
                Importa {processedProducts.filter(p => p.isValid).length} Prodotti →
              </button>
            </div>
          </div>
        )}

        {/* STEP 4: IMPORTING */}
        {step === "importing" && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <h2 className="text-2xl font-bold mb-6">⏳ Importazione in corso...</h2>
            
            <div className="w-full bg-gray-200 rounded-full h-4 mb-4">
              <div
                className="bg-blue-500 h-4 rounded-full transition-all duration-300"
                style={{ width: `${importProgress}%` }}
              />
            </div>
            
            <p className="text-gray-600">{importProgress}%</p>
          </div>
        )}

        {/* STEP 5: COMPLETE */}
        {step === "complete" && (
          <div className="bg-white rounded-lg shadow p-8">
            <h2 className="text-2xl font-bold mb-6">
              {importResults.errors.length === 0 ? "✅ Import Completato!" : "⚠️ Import Completato con Errori"}
            </h2>
            
            <div className="space-y-4 mb-6">
              <div className="p-4 bg-green-50 rounded">
                <strong className="text-green-700">Importati con successo:</strong> {importResults.success}
              </div>
              
              {importResults.duplicates > 0 && (
                <div className="p-4 bg-yellow-50 rounded">
                  <strong className="text-yellow-700">Duplicati ignorati:</strong> {importResults.duplicates}
                </div>
              )}
              
              {importResults.failed > 0 && (
                <div className="p-4 bg-red-50 rounded">
                  <strong className="text-red-700">Falliti:</strong> {importResults.failed}
                </div>
              )}
              
              {importResults.errors.length > 0 && (
                <div className="p-4 bg-red-50 rounded">
                  <strong className="text-red-700">Errori:</strong>
                  <ul className="mt-2 text-sm list-disc list-inside">
                    {importResults.errors.map((err, idx) => (
                      <li key={idx}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            <div className="flex gap-4">
              <button
                onClick={handleReset}
                className="px-6 py-2 border rounded hover:bg-gray-100"
              >
                Nuovo Import
              </button>
              <button
                onClick={() => router.push("/products")}
                className="px-6 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Vai a Prodotti →
              </button>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
