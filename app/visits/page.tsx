'use client';

import React, { useEffect, useRef, useState, useMemo } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useCrypto } from '@/lib/crypto/CryptoProvider';
import { useDrawers, DrawersWithBackdrop } from '@/components/Drawers';
import TopBar from '@/components/home/TopBar';

type PlainVisit = {
  id: string;
  account_id: string;
  tipo: 'visita' | 'chiamata';
  data_visita: string;
  cliente_nome: string;
  esito: string;
  durata: number | null;
  importo_vendita: number | null;
  note: string;
  prodotti_discussi: string | null;  // 🆕 Prodotti discussi/venduti
  created_at: string;
};

type SortKey = "data_visita" | "tipo" | "cliente_nome" | "esito" | "importo_vendita";

const DEFAULT_SCOPES = ["table:accounts", "table:visits"];

export default function VisitsPage(): JSX.Element {
  const { crypto, ready, unlock, prewarm } = useCrypto();
  const { leftOpen, rightOpen, rightContent, openLeft, closeLeft, openDati, openDocs, openImpostazioni, closeRight } = useDrawers();

  const actuallyReady = ready || !!(crypto as any)?.isUnlocked?.();

  const [rows, setRows] = useState<PlainVisit[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [authChecked, setAuthChecked] = useState<boolean>(false);
  const unlockingRef = useRef(false);

  const [sortBy, setSortBy] = useState<SortKey>("data_visita");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filterTipo, setFilterTipo] = useState<'tutti' | 'visita' | 'chiamata'>('tutti');
  const [q, setQ] = useState<string>('');

  const [editingImporto, setEditingImporto] = useState<string | null>(null);
  const [tempImporto, setTempImporto] = useState<string>('');

  const [pass, setPass] = useState<string>('');

  // 🆕 STATO PER MODAL ELIMINAZIONE VISITA
  const [deleteModal, setDeleteModal] = useState<{open: boolean, visitId: string | null, clientName: string, dataVisita: string}>({
    open: false,
    visitId: null,
    clientName: '',
    dataVisita: ''
  });

  function handleSortClick(key: SortKey) {
    if (sortBy === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
  }

  async function logout() {
    try { sessionStorage.removeItem("repping:pph"); } catch {}
    try { localStorage.removeItem("repping:pph"); } catch {}
    await supabase.auth.signOut();
    window.location.href = '/login';
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data, error } = await supabase.auth.getUser();
      if (!alive) return;
      if (error) {
        setUserId(null);
      } else {
        setUserId(data.user?.id ?? null);
      }
      setAuthChecked(true);
    })();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!authChecked || !crypto) return;
    if (typeof crypto.isUnlocked === 'function' && crypto.isUnlocked()) return;
    if (unlockingRef.current) return;

    const pass = typeof window !== 'undefined' ? (sessionStorage.getItem('repping:pph') || localStorage.getItem('repping:pph') || '') : '';
    if (!pass) return;

    (async () => {
      try {
        unlockingRef.current = true;
        await unlock(pass);
        await prewarm(DEFAULT_SCOPES);
        await loadVisits();
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        console.error('[/visits] Unlock fallito:', msg);
        if (!/OperationError/i.test(msg)) {
          sessionStorage.removeItem('repping:pph');
          localStorage.removeItem('repping:pph');
        }
      } finally {
        unlockingRef.current = false;
      }
    })();
  }, [authChecked, crypto, unlock, prewarm]);

  // 🔧 FIX: Carica visite automaticamente se crypto è già sbloccato
  useEffect(() => {
    // 🎮 Demo mode: carica dati senza crypto
    const isDemoMode = typeof window !== 'undefined' && 
      sessionStorage.getItem('reping:isAnonDemo') === 'true';
    
    if (isDemoMode && userId) {
      console.log('[/visits] 🎮 Demo mode - carico dati');
      if (rows.length === 0 && !loading) loadVisits();
      return;
    }
    
    if (!actuallyReady || !crypto || !userId) return;
    if (rows.length > 0) return; // Già caricato
    if (loading) return; // Già in caricamento
    
    loadVisits();
  }, [actuallyReady, crypto, userId]);

  async function loadVisits(): Promise<void> {
    const isDemoMode = typeof window !== 'undefined' && 
      sessionStorage.getItem('reping:isAnonDemo') === 'true';
    if (!isDemoMode && !crypto) return;
    if (!userId) return;
    setLoading(true);

    try {
      const { data: visitsData, error: visitsError } = await supabase
        .from('visits')
        .select('*')
        .eq('user_id', userId)
        .order('data_visita', { ascending: false });

      if (visitsError) {
        console.error('[/visits] load error:', visitsError);
        setLoading(false);
        return;
      }

      const accountIds = [...new Set((visitsData || []).map((v: any) => v.account_id))];
      const { data: accountsData, error: accountsError } = await supabase
        .from('accounts')
        .select('id, name_enc, name_iv')
        .in('id', accountIds);

      if (accountsError) {
        console.error('[/visits] accounts load error:', accountsError);
      }

      const accountsMap = new Map<string, any>();
      for (const acc of (accountsData || [])) {
        accountsMap.set(acc.id, acc);
      }

      const hexToBase64 = (hexStr: any): string => {
        if (!hexStr || typeof hexStr !== 'string') return '';
        if (!hexStr.startsWith('\\x')) return hexStr;
        const hex = hexStr.slice(2);
        const bytes = hex.match(/.{1,2}/g)?.map(b => String.fromCharCode(parseInt(b, 16))).join('') || '';
        return bytes;
      };

      const toObj = (x: any): Record<string, unknown> =>
        Array.isArray(x)
          ? x.reduce((acc: Record<string, unknown>, it: any) => {
              if (it && typeof it === 'object' && "name" in it) acc[it.name] = it.value ?? "";
              return acc;
            }, {})
          : ((x ?? {}) as Record<string, unknown>);

      try {
        await (crypto as any).getOrCreateScopeKeys('table:accounts');
      } catch (e) {
        console.error('[/visits] Errore creazione scope keys:', e);
      }

      const plain: PlainVisit[] = [];

      for (const r of (visitsData || [])) {
        try {
          let clienteNome = 'Cliente Sconosciuto';

          const account = accountsMap.get(r.account_id);
          if (account && account.name_enc && account.name_iv) {
            try {
              const accountForDecrypt = {
                name_enc: hexToBase64(account.name_enc),
                name_iv: hexToBase64(account.name_iv),
              };

              // 🔧 FIX: Usa account.id come AAD per decifratura corretta
              const decAny = await (crypto as any).decryptFields(
                "table:accounts", "accounts", account.id, accountForDecrypt, ["name"]
              );
              const dec = toObj(decAny);
              clienteNome = String(dec.name ?? 'Cliente Sconosciuto');
            } catch (err) {
              console.error('[/visits] decrypt name error:', err);
            }
          }

          plain.push({
            id: r.id,
            account_id: r.account_id,
            tipo: r.tipo,
            data_visita: r.data_visita,
            cliente_nome: clienteNome,
            esito: r.esito || '—',
            durata: r.durata,
            importo_vendita: r.importo_vendita,
            note: r.notes || '',
            prodotti_discussi: r.prodotti_discussi || null,  // 🆕
            created_at: r.created_at,
          });
        } catch (e) {
          console.warn('[/visits] decrypt error for', r.id, e);
        }
      }

      setRows(plain);
    } catch (err) {
      console.error('[/visits] unexpected error:', err);
    } finally {
      setLoading(false);
    }
  }

  async function updateImporto(visitId: string, newImporto: string) {
    const importo = parseFloat(newImporto);
    if (isNaN(importo) || importo < 0) {
      alert('Importo non valido');
      return;
    }

    try {
      const { error } = await supabase
        .from('visits')
        .update({ importo_vendita: importo > 0 ? importo : null })
        .eq('id', visitId);

      if (error) throw error;

      setRows(rows.map(r => r.id === visitId ? { ...r, importo_vendita: importo > 0 ? importo : null } : r));
      setEditingImporto(null);
    } catch (e: any) {
      console.error('[/visits] update importo error:', e);
      alert(e?.message || 'Errore durante aggiornamento');
    }
  }

  const filtered = useMemo(() => {
    let result = rows.filter((v) => {
      if (filterTipo !== 'tutti' && v.tipo !== filterTipo) return false;
      if (q.trim() && !v.cliente_nome.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });

    result.sort((a, b) => {
      let aVal: any = a[sortBy];
      let bVal: any = b[sortBy];

      if (sortBy === 'importo_vendita') {
        aVal = aVal || 0;
        bVal = bVal || 0;
      }

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [rows, filterTipo, q, sortBy, sortDir]);

  const stats = useMemo(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today);
    monthAgo.setDate(monthAgo.getDate() - 30);
    const quarterStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

    const calcStats = (startDate: Date) => {
      const visits = rows.filter(v => new Date(v.data_visita) >= startDate);
      return {
        count: visits.length,
        total: visits.reduce((sum, v) => sum + (v.importo_vendita || 0), 0)
      };
    };

    return {
      quarter: calcStats(quarterStart),
      month: calcStats(monthAgo),
      week: calcStats(weekAgo),
      today: calcStats(today)
    };
  }, [rows]);

  function formatDate(isoStr: string): string {
    const d = new Date(isoStr);
    return d.toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  // 🆕 APRI MODAL ELIMINAZIONE
  function openDeleteModal(visitId: string, clientName: string, dataVisita: string) {
    setDeleteModal({ open: true, visitId, clientName, dataVisita: formatDate(dataVisita) });
  }

  // 🆕 CHIUDI MODAL ELIMINAZIONE
  function closeDeleteModal() {
    setDeleteModal({ open: false, visitId: null, clientName: '', dataVisita: '' });
  }

  // 🆕 CONFERMA ELIMINAZIONE VISITA
  async function confirmDeleteVisit() {
    if (!deleteModal.visitId) return;
    
    try {
      const { error } = await supabase
        .from('visits')
        .delete()
        .eq('id', deleteModal.visitId);
      
      if (error) throw error;
      
      // Rimuovi dalla lista locale
      setRows(prev => prev.filter(r => r.id !== deleteModal.visitId));
      closeDeleteModal();
    } catch (e: any) {
      console.error('[/visits] delete error:', e);
      alert(`Errore durante l'eliminazione: ${e.message}`);
    }
  }

  if (!authChecked) {
    return (<div style={{ padding: 20, textAlign: 'center' }}>Caricamento...</div>);
  }

  if (!userId) {
    return (<div style={{ padding: 20, textAlign: 'center' }}>Non autenticato. <a href="/login">Login</a></div>);
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
  // In demo/skip mode, bypassa completamente il check crypto
  if (!isDemoMode && !hasSkippedOnboarding && (!actuallyReady || !crypto)) {
    const hasPassInStorage = typeof window !== 'undefined' && 
      (sessionStorage.getItem('repping:pph') || localStorage.getItem('repping:pph'));
    
    // Se c'è passphrase in storage, mostra loader (auto-unlock in corso)
    if (hasPassInStorage) {
      return (
        <div style={{ padding: 24, textAlign: 'center', marginTop: 100 }}>
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
      <div style={{ padding: 24, maxWidth: 448, margin: '0 auto' }}>
        <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 12 }}>🔐 Sblocca i dati cifrati</h2>
        <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 16 }}>
          Inserisci la tua passphrase per sbloccare la cifratura client-side (valida per questa sessione).
        </p>
        <input
          type="password"
          placeholder="Passphrase"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, marginBottom: 12 }}
        />
        <button
          onClick={async () => {
            try {
              await unlock(pass);
              await prewarm(DEFAULT_SCOPES);
              await loadVisits();
              setPass("");
            } catch (e) {
              console.error("[/visits] unlock failed:", e);
              alert("Passphrase non valida o sblocco fallito.");
            }
          }}
          style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, cursor: 'pointer' }}
        >
          Sblocca
        </button>
        <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 12 }}>
          ready: {String(ready)}
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1000, background: 'white', borderBottom: '1px solid #e5e7eb' }}>
        <TopBar
          title="Visite & Chiamate"
          onOpenLeft={openLeft}
          onOpenDati={openDati}
          onOpenDocs={openDocs}
          onOpenImpostazioni={openImpostazioni}
          onLogout={logout}
        />
      </div>

      <DrawersWithBackdrop
        leftOpen={leftOpen}
        onCloseLeft={closeLeft}
        rightOpen={rightOpen}
        rightContent={rightContent}
        onCloseRight={closeRight}
      />

      <div style={{ paddingTop: 60, padding: '70px 16px 16px' }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select value={filterTipo} onChange={(e) => setFilterTipo(e.target.value as any)} style={{ padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14, background: 'white' }}>
              <option value="tutti">Tutti i tipi</option>
              <option value="visita">Solo visite</option>
              <option value="chiamata">Solo chiamate</option>
            </select>

            <input type="text" placeholder="Cerca cliente..." value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 14 }} />

            <button onClick={() => window.location.href = '/tools/add-visit'} style={{ padding: '8px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: 6, fontSize: 14, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap' }}>➕ Nuova</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
            <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 13 }}>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>📅 Trimestre</div>
              <div style={{ fontWeight: 500 }}>{stats.quarter.count} visite • <span style={{ color: '#059669' }}>€{stats.quarter.total.toFixed(2)}</span></div>
            </div>
            <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 13 }}>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>📆 Ultimo mese</div>
              <div style={{ fontWeight: 500 }}>{stats.month.count} visite • <span style={{ color: '#059669' }}>€{stats.month.total.toFixed(2)}</span></div>
            </div>
            <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 13 }}>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>🗓️ Ultima settimana</div>
              <div style={{ fontWeight: 500 }}>{stats.week.count} visite • <span style={{ color: '#059669' }}>€{stats.week.total.toFixed(2)}</span></div>
            </div>
            <div style={{ padding: '8px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 13 }}>
              <div style={{ color: '#6b7280', marginBottom: 2 }}>📌 Oggi</div>
              <div style={{ fontWeight: 500 }}>{stats.today.count} visite • <span style={{ color: '#059669' }}>€{stats.today.total.toFixed(2)}</span></div>
            </div>
          </div>

          <div style={{ fontSize: 13, color: '#6b7280' }}>
            {filtered.length} {filtered.length === 1 ? 'visita visualizzata' : 'visite visualizzate'}
          </div>
        </div>

        {loading && (<div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>Caricamento visite...</div>)}

        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: 40, color: '#6b7280' }}>
            {rows.length === 0 ? (
              <>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📅</div>
                <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Nessuna visita registrata</div>
                <div style={{ fontSize: 14 }}>Inizia a registrare le tue visite e chiamate ai clienti</div>
              </>
            ) : ('Nessuna visita trovata con questi filtri')}
          </div>
        )}

        {!loading && filtered.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                  <th onClick={() => handleSortClick('data_visita')} style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                    Data {sortBy === 'data_visita' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSortClick('tipo')} style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                    Tipo {sortBy === 'tipo' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSortClick('cliente_nome')} style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                    Cliente {sortBy === 'cliente_nome' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSortClick('esito')} style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                    Esito {sortBy === 'esito' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSortClick('importo_vendita')} style={{ padding: '12px 8px', textAlign: 'right', fontWeight: 600, cursor: 'pointer', userSelect: 'none' }}>
                    Importo {sortBy === 'importo_vendita' && (sortDir === 'asc' ? '↑' : '↓')}
                  </th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 600 }}>Durata</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 600 }}>Prodotti</th>
                  <th style={{ padding: '12px 8px', textAlign: 'left', fontWeight: 600 }}>Note</th>
                  <th style={{ padding: '12px 8px', textAlign: 'center', fontWeight: 600 }}>Azioni</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.id} style={{ borderBottom: '1px solid #e5e7eb', transition: 'background 0.15s' }} onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '12px 8px' }}>{formatDate(v.data_visita)}</td>
                    <td style={{ padding: '12px 8px' }}>
                      <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 12, fontWeight: 500, background: v.tipo === 'visita' ? '#dbeafe' : '#fef3c7', color: v.tipo === 'visita' ? '#1e40af' : '#92400e' }}>
                        {v.tipo === 'visita' ? '🚗 Visita' : '📞 Chiamata'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 8px', fontWeight: 500 }}>
                      <a 
                        href={`/clients/${v.account_id}`}
                        style={{ color: '#2563eb', textDecoration: 'none' }}
                        title="Apri scheda cliente"
                      >
                        {v.cliente_nome}
                      </a>
                    </td>
                    <td style={{ padding: '12px 8px', color: '#6b7280' }}>{v.esito}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'right' }}>
                      {editingImporto === v.id ? (
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end' }}>
                          <input
                            type="number"
                            step="0.01"
                            value={tempImporto}
                            onChange={(e) => setTempImporto(e.target.value)}
                            onKeyDown={(e) => { 
                              if (e.key === 'Enter' && tempImporto !== String(v.importo_vendita || '0')) updateImporto(v.id, tempImporto); 
                              if (e.key === 'Escape') setEditingImporto(null); 
                            }}
                            autoFocus
                            style={{ width: 70, padding: '4px 6px', border: '1px solid #2563eb', borderRadius: 4, fontSize: 13, textAlign: 'right' }}
                          />
                          <button
                            onClick={() => updateImporto(v.id, tempImporto)}
                            disabled={tempImporto === String(v.importo_vendita || '0')}
                            title="Conferma"
                            style={{
                              padding: '4px 8px',
                              borderRadius: 4,
                              border: 'none',
                              background: tempImporto !== String(v.importo_vendita || '0') ? '#10b981' : '#d1d5db',
                              color: 'white',
                              cursor: tempImporto !== String(v.importo_vendita || '0') ? 'pointer' : 'not-allowed',
                              fontSize: 14,
                            }}
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => setEditingImporto(null)}
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
                      ) : (
                        <span
                          onClick={() => { setEditingImporto(v.id); setTempImporto(String(v.importo_vendita || '0')); }}
                          style={{ cursor: 'pointer', color: v.importo_vendita ? '#059669' : '#9ca3af', fontWeight: v.importo_vendita ? 500 : 400 }}
                          title="Clicca per modificare"
                        >
                          {v.importo_vendita ? `€${v.importo_vendita.toFixed(2)}` : '—'}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: '12px 8px', color: '#6b7280' }}>{v.durata ? `${v.durata} min` : '—'}</td>
                    <td style={{ padding: '12px 8px', color: '#6b7280', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={v.prodotti_discussi || ''}>
                      {v.prodotti_discussi ? `📦 ${v.prodotti_discussi}` : '—'}
                    </td>
                    <td style={{ padding: '12px 8px', color: '#6b7280', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.note || '—'}</td>
                    <td style={{ padding: '12px 8px', textAlign: 'center' }}>
                      <button
                        onClick={() => openDeleteModal(v.id, v.cliente_nome, v.data_visita)}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          cursor: 'pointer',
                          fontSize: 16,
                          padding: 4,
                        }}
                        title="Elimina visita"
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 🆕 MODAL CONFERMA ELIMINAZIONE VISITA */}
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
              Eliminare questa visita?
            </h3>
            <p style={{ fontSize: 14, color: '#6b7280', textAlign: 'center', marginBottom: 16 }}>
              Visita del <strong>{deleteModal.dataVisita}</strong> a:
            </p>
            <p style={{ fontSize: 16, fontWeight: 600, textAlign: 'center', marginBottom: 16, color: '#111827' }}>
              {deleteModal.clientName}
            </p>
            <p style={{ fontSize: 13, color: '#ef4444', textAlign: 'center', marginBottom: 24 }}>
              ⚠️ Questa azione è irreversibile.
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
                onClick={confirmDeleteVisit}
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
