// components/drawers/DrawerImpostazioni.tsx
// Estratto da components/Drawers.tsx per mantenibilità

"use client";
import { useEffect, useState } from "react";
import { geocodeAddress } from '@/lib/geocoding';
import { supabase } from '@/lib/supabase/client';

interface DrawerImpostazioniProps {
  onClose: () => void;
}

export default function DrawerImpostazioni({ onClose }: DrawerImpostazioniProps) {
  // Stato Indirizzo Casa
  const [addressExpanded, setAddressExpanded] = useState(false);
  const [homeAddress, setHomeAddress] = useState('');
  const [homeCity, setHomeCity] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedCoords, setSavedCoords] = useState<string | null>(null);

  // Stato Pagina Iniziale
  const [homePageExpanded, setHomePageExpanded] = useState(false);
  const [homePageMode, setHomePageMode] = useState<'chat' | 'dashboard'>('chat');

  // Stato Napoleone
  const [napoleonExpanded, setNapoleonExpanded] = useState(false);
  const [napoleonEnabled, setNapoleonEnabled] = useState(true);

  // Stato Riepilogo Settimanale
  const [weeklyExpanded, setWeeklyExpanded] = useState(false);
  const [weeklyEnabled, setWeeklyEnabled] = useState(true);

  // 🧪 Stato Test Companion Panel
  const [testPanelExpanded, setTestPanelExpanded] = useState(false);
  const [testPanelEnabled, setTestPanelEnabled] = useState(true);

  // 👑 Stato Admin
  const [isAdmin, setIsAdmin] = useState(false);

  // Carica impostazioni salvate
  useEffect(() => {
    const saved = localStorage.getItem('repping_settings');
    if (saved) {
      try {
        const data = JSON.parse(saved);
        if (data.homeAddress) setHomeAddress(data.homeAddress);
        if (data.homeCity) setHomeCity(data.homeCity);
        if (data.homeLat && data.homeLon) {
          setSavedCoords(`${data.homeLat}, ${data.homeLon}`);
        }
        if (data.homePageMode === 'dashboard' || data.homePageMode === 'chat') {
          setHomePageMode(data.homePageMode);
        }
      } catch {}
    }
    // Carica preferenza Napoleone
    const napoleonVisible = localStorage.getItem('napoleon_visible');
    if (napoleonVisible === 'false') {
      setNapoleonEnabled(false);
    }
    // Carica preferenza Riepilogo Settimanale
    const weeklyVisible = localStorage.getItem('weekly_summary_visible');
    if (weeklyVisible === 'false') {
      setWeeklyEnabled(false);
    }
    // 🧪 Carica preferenza Test Panel
    const testPanelVisible = localStorage.getItem('test_panel_enabled');
    if (testPanelVisible === 'false') {
      setTestPanelEnabled(false);
    }
    // 👑 Verifica se utente è admin
    checkAdminRole();
  }, []);

  async function checkAdminRole() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      
      if (profile?.role === 'admin') {
        setIsAdmin(true);
      }
    } catch (e) {
      console.error('[Settings] Error checking admin role:', e);
    }
  }

  function handleHomePageModeChange(mode: 'chat' | 'dashboard') {
    setHomePageMode(mode);
    try {
      const saved = localStorage.getItem('repping_settings');
      const data = saved ? JSON.parse(saved) : {};
      data.homePageMode = mode;
      localStorage.setItem('repping_settings', JSON.stringify(data));
      window.dispatchEvent(new CustomEvent('repping:homePageModeChanged', { detail: { mode } }));
    } catch {}
  }

  function handleNapoleonToggle(enabled: boolean) {
    setNapoleonEnabled(enabled);
    localStorage.setItem('napoleon_visible', String(enabled));
    // Dispatch event per aggiornare la dashboard
    window.dispatchEvent(new CustomEvent('repping:napoleonVisibilityChanged', { detail: { enabled } }));
  }

  function handleWeeklyToggle(enabled: boolean) {
    setWeeklyEnabled(enabled);
    localStorage.setItem('weekly_summary_visible', String(enabled));
    // Dispatch event per aggiornare la dashboard
    window.dispatchEvent(new CustomEvent('repping:weeklySummaryVisibilityChanged', { detail: { enabled } }));
  }

  // 🧪 Toggle Test Panel
  function handleTestPanelToggle(enabled: boolean) {
    setTestPanelEnabled(enabled);
    localStorage.setItem('test_panel_enabled', String(enabled));
    // Dispatch event per aggiornare il pannello in tempo reale
    window.dispatchEvent(new CustomEvent('repping:testPanelChanged', { detail: { enabled } }));
  }

  async function handleSaveAddress() {
    if (!homeAddress.trim() || !homeCity.trim()) {
      alert('Inserisci indirizzo e città');
      return;
    }

    setSaving(true);
    try {
      const coords = await geocodeAddress(homeAddress, homeCity);
      
      if (!coords) {
        alert('Indirizzo non trovato. Verifica i dati.');
        return;
      }

      const settings = {
        homeAddress, homeCity,
        homeLat: coords.latitude,
        homeLon: coords.longitude,
        updatedAt: new Date().toISOString()
      };
      
      localStorage.setItem('repping_settings', JSON.stringify(settings));
      setSavedCoords(`${coords.latitude}, ${coords.longitude}`);
      alert('✅ Impostazioni salvate!\nIl punto di partenza verrà usato per ottimizzare i percorsi.');
    } catch (e: any) {
      console.error(e);
      alert('Errore durante il salvataggio');
    } finally {
      setSaving(false);
    }
  }

  const accordionButtonStyle = (isExpanded: boolean) => ({
    width: '100%',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 16px',
    background: '#f9fafb',
    border: '1px solid #e5e7eb',
    borderRadius: isExpanded ? '8px 8px 0 0' : 8,
    cursor: 'pointer',
    fontSize: 16,
    fontWeight: 600,
    color: '#111827',
  });

  const accordionContentStyle = {
    padding: 16,
    border: '1px solid #e5e7eb',
    borderTop: 'none',
    borderRadius: '0 0 8px 8px',
    background: 'white',
  };

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" onClick={onClose}>Chiudi</button>
        <div className="title">Impostazioni</div>
      </div>
      <div className="list" style={{ padding: 16 }}>
        
        {/* SEZIONE PRIVACY E DATI - PRIMA */}
        <div style={{ marginBottom: 16 }}>
          <a 
            href="/settings/my-data"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              background: '#f8fafc',
              borderRadius: 12,
              textDecoration: 'none',
              color: '#334155',
              border: '1px solid #e2e8f0',
              transition: 'all 0.2s',
            }}
            onMouseOver={e => {
              e.currentTarget.style.background = '#f1f5f9';
              e.currentTarget.style.borderColor = '#cbd5e1';
            }}
            onMouseOut={e => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 24 }}>🔐</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>I Miei Dati</div>
                <div style={{ fontSize: 11, color: '#64748b' }}>Visualizza, esporta, cancella (GDPR)</div>
              </div>
            </div>
            <span style={{ fontSize: 16, color: '#94a3b8' }}>→</span>
          </a>
        </div>

        {/* SEZIONE INDIRIZZO CASA */}
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setAddressExpanded(!addressExpanded)} style={accordionButtonStyle(addressExpanded)}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span>📍 Punto di Partenza</span>
              {homeAddress && homeCity && !addressExpanded && (
                <span style={{ fontSize: 11, color: '#059669', fontWeight: 400 }}>✓ {homeAddress}, {homeCity}</span>
              )}
            </div>
            <span style={{ fontSize: 12 }}>{addressExpanded ? '▲' : '▼'}</span>
          </button>
          
          {addressExpanded && (
            <div style={accordionContentStyle}>
              {homeAddress && homeCity && savedCoords && (
                <div style={{ padding: 12, background: '#f0fdf4', borderRadius: 8, marginBottom: 16, border: '1px solid #bbf7d0' }}>
                  <div style={{ fontSize: 12, color: '#166534', fontWeight: 600, marginBottom: 4 }}>✓ Indirizzo salvato</div>
                  <div style={{ fontSize: 13, color: '#166534' }}>{homeAddress}, {homeCity}</div>
                  <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>Coordinate: {savedCoords}</div>
                </div>
              )}
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
                {homeAddress && homeCity ? 'Modifica il tuo indirizzo di partenza se necessario.' : 'Imposta il tuo indirizzo di casa o ufficio. Verrà usato per ottimizzare i percorsi giornalieri.'}
              </p>
              
              <div style={{ display: 'grid', gap: 12 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Indirizzo</label>
                  <input value={homeAddress} onChange={e => setHomeAddress(e.target.value)} placeholder="Es. Via Roma 10" style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 4 }}>Città</label>
                  <input value={homeCity} onChange={e => setHomeCity(e.target.value)} placeholder="Es. Milano" style={{ width: '100%', padding: '10px', borderRadius: 8, border: '1px solid #d1d5db' }} />
                </div>
                <button onClick={handleSaveAddress} disabled={saving} style={{ marginTop: 8, width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: '#2563eb', color: 'white', fontWeight: 600, cursor: 'pointer', opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Salvataggio...' : '💾 Salva Indirizzo'}
                </button>
                {savedCoords && (
                  <div style={{ marginTop: 8, padding: 12, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0', fontSize: 12, color: '#15803d' }}>
                    ✅ Coordinate salvate: {savedCoords}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* SEZIONE PAGINA INIZIALE */}
        <div style={{ marginBottom: 16 }}>
          <button onClick={() => setHomePageExpanded(!homePageExpanded)} style={accordionButtonStyle(homePageExpanded)}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span>🏠 Pagina Iniziale</span>
              {!homePageExpanded && (
                <span style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>{homePageMode === 'chat' ? '💬 Chat' : '📊 Dashboard'}</span>
              )}
            </div>
            <span style={{ fontSize: 12 }}>{homePageExpanded ? '▲' : '▼'}</span>
          </button>
          
          {homePageExpanded && (
            <div style={accordionContentStyle}>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Scegli cosa vedere quando apri l'app:</p>
              
              <div style={{ display: 'grid', gap: 12 }}>
                <HomePageOption mode="chat" currentMode={homePageMode} onChange={handleHomePageModeChange} title="Chat Assistente" description="Parla con l'assistente AI per cercare clienti, prodotti, info" icon="💬" />
                <HomePageOption mode="dashboard" currentMode={homePageMode} onChange={handleHomePageModeChange} title="Dashboard" description="KPI giornalieri, azioni rapide, riepilogo attività" icon="📊" />
              </div>

              <div style={{ marginTop: 16, padding: 12, background: '#fef3c7', borderRadius: 8, fontSize: 12, color: '#92400e', border: '1px solid #fde68a' }}>
                💡 Puoi sempre accedere all'altra vista dal menu laterale
              </div>
            </div>
          )}
        </div>

        {/* SEZIONE NAPOLEONE */}
        <div style={{ marginBottom: 16 }}>
          <button 
            onClick={() => setNapoleonExpanded(!napoleonExpanded)} 
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px',
              background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
              border: 'none',
              borderRadius: napoleonExpanded ? '12px 12px 0 0' : 12,
              cursor: 'pointer',
              color: 'white',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>💡 Napoleone</span>
              {!napoleonExpanded && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>
                  {napoleonEnabled ? '✓ Attivo' : '○ Disattivato'}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12 }}>{napoleonExpanded ? '▲' : '▼'}</span>
          </button>
          
          {napoleonExpanded && (
            <div style={{
              padding: 16,
              border: 'none',
              borderTop: 'none',
              borderRadius: '0 0 12px 12px',
              background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
            }}>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginBottom: 16 }}>
                Napoleone analizza i tuoi dati e ti suggerisce azioni: clienti da chiamare, opportunità da cogliere.
              </p>
              
              <div 
                onClick={() => handleNapoleonToggle(!napoleonEnabled)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px',
                  background: napoleonEnabled ? 'rgba(59, 130, 246, 0.3)' : 'rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  border: napoleonEnabled ? '2px solid #3b82f6' : '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>💡</span>
                  <div>
                    <div style={{ fontWeight: 600, color: 'white' }}>Mostra in Dashboard</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                      {napoleonEnabled ? 'Vedrai i suggerimenti nella home' : 'I suggerimenti sono nascosti'}
                    </div>
                  </div>
                </div>
                <div style={{
                  width: 44, height: 24, borderRadius: 12,
                  background: napoleonEnabled ? '#3b82f6' : '#d1d5db',
                  position: 'relative', transition: 'background 0.2s',
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 10,
                    background: 'white', position: 'absolute', top: 2,
                    left: napoleonEnabled ? 22 : 2,
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SEZIONE FEEDBACK GIORNALIERO */}
        <div style={{ marginBottom: 16 }}>
          <button 
            onClick={() => setWeeklyExpanded(!weeklyExpanded)} 
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '14px 16px',
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
              border: 'none',
              borderRadius: weeklyExpanded ? '12px 12px 0 0' : 12,
              cursor: 'pointer',
              color: 'white',
              transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
              <span style={{ fontWeight: 600, fontSize: 15 }}>📊 Feedback Giornaliero</span>
              {!weeklyExpanded && (
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>
                  {weeklyEnabled ? '✓ Attivo' : '○ Disattivato'}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12 }}>{weeklyExpanded ? '▲' : '▼'}</span>
          </button>
          
          {weeklyExpanded && (
            <div style={{
              padding: 16,
              border: 'none',
              borderTop: 'none',
              borderRadius: '0 0 12px 12px',
              background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
            }}>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginBottom: 16 }}>
                A fine giornata ti chiedo com&apos;è andata con un semplice feedback.
              </p>
              
              <div 
                onClick={() => handleWeeklyToggle(!weeklyEnabled)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '16px',
                  background: weeklyEnabled ? 'rgba(16, 185, 129, 0.3)' : 'rgba(255,255,255,0.1)',
                  borderRadius: 12,
                  border: weeklyEnabled ? '2px solid #10b981' : '1px solid rgba(255,255,255,0.2)',
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 24 }}>📊</span>
                  <div>
                    <div style={{ fontWeight: 600, color: 'white' }}>Chiedi feedback</div>
                    <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                      {weeklyEnabled ? 'Dopo le 18 ti chiederò com\'è andata' : 'Il feedback è disattivato'}
                    </div>
                  </div>
                </div>
                <div style={{
                  width: 44, height: 24, borderRadius: 12,
                  background: weeklyEnabled ? '#10b981' : '#d1d5db',
                  position: 'relative', transition: 'background 0.2s',
                }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: 10,
                    background: 'white', position: 'absolute', top: 2,
                    left: weeklyEnabled ? 22 : 2,
                    transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                  }} />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* 🧪 SEZIONE TEST COMPANION - SOLO ADMIN */}
        {isAdmin && (
          <div style={{ marginBottom: 16 }}>
            <button 
              onClick={() => setTestPanelExpanded(!testPanelExpanded)} 
              style={{
                width: '100%',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '14px 16px',
                background: 'linear-gradient(135deg, #4338ca 0%, #6366f1 100%)',
                border: 'none',
                borderRadius: testPanelExpanded ? '12px 12px 0 0' : 12,
                cursor: 'pointer',
                color: 'white',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                <span style={{ fontWeight: 600, fontSize: 15 }}>🧪 Test Companion</span>
                {!testPanelExpanded && (
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', fontWeight: 400 }}>
                    {testPanelEnabled ? '✓ Attivo' : '○ Disattivato'}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12 }}>{testPanelExpanded ? '▲' : '▼'}</span>
            </button>
            
            {testPanelExpanded && (
              <div style={{
                padding: 16,
                border: 'none',
                borderTop: 'none',
                borderRadius: '0 0 12px 12px',
                background: 'linear-gradient(135deg, #4338ca 0%, #6366f1 100%)',
              }}>
                <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginBottom: 16 }}>
                  Pannello per inviare segnalazioni durante il testing Beta.
                </p>
                
                <div 
                  onClick={() => handleTestPanelToggle(!testPanelEnabled)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '16px',
                    background: testPanelEnabled ? 'rgba(99, 102, 241, 0.3)' : 'rgba(255,255,255,0.1)',
                    borderRadius: 12,
                    border: testPanelEnabled ? '2px solid #6366f1' : '1px solid rgba(255,255,255,0.2)',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontSize: 24 }}>🧪</span>
                    <div>
                      <div style={{ fontWeight: 600, color: 'white' }}>Mostra pannello</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                        {testPanelEnabled ? 'Bottone 🧪 visibile in basso a dx' : 'Pannello nascosto'}
                      </div>
                    </div>
                  </div>
                  <div style={{
                    width: 44, height: 24, borderRadius: 12,
                    background: testPanelEnabled ? '#6366f1' : '#d1d5db',
                    position: 'relative', transition: 'background 0.2s',
                  }}>
                    <div style={{
                      width: 20, height: 20, borderRadius: 10,
                      background: 'white', position: 'absolute', top: 2,
                      left: testPanelEnabled ? 22 : 2,
                      transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }} />
                  </div>
                </div>

                <div style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  <p>💡 Usa le categorie per segnalare:</p>
                  <p style={{ marginLeft: 8, marginTop: 4 }}>🐛 Bug • 💡 Miglioramento</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SEZIONE DIALOGO */}
        <div style={{ marginBottom: 16 }}>
          <button 
            onClick={() => {
              // Setta flag per attivare dialogo nella chat
              localStorage.setItem('activate_dialog_mode', 'true');
              // Emetti evento per attivare dialogo
              window.dispatchEvent(new CustomEvent('repping:activateDialog'));
              // Chiudi drawer
              onClose?.();
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '16px',
              background: 'linear-gradient(135deg, #4b5563 0%, #9ca3af 100%)',
              borderRadius: 12,
              border: 'none',
              width: '100%',
              cursor: 'pointer',
              color: 'white',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseOver={e => {
              e.currentTarget.style.transform = 'scale(1.02)';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.2)';
            }}
            onMouseOut={e => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 28 }}>🎙️</span>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontWeight: 600, fontSize: 16 }}>Dialogo</div>
                <div style={{ fontSize: 12, opacity: 0.9 }}>Modalità hands-free</div>
              </div>
            </div>
            <span style={{ fontSize: 20 }}>→</span>
          </button>
        </div>

        {/* 👑 SEZIONE ADMIN - Solo per admin */}
        {isAdmin && (
          <div style={{ marginBottom: 16 }}>
            <a 
              href="/admin"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px',
                background: 'linear-gradient(135deg, #dc2626 0%, #f97316 100%)',
                borderRadius: 12,
                textDecoration: 'none',
                color: 'white',
                border: 'none',
                transition: 'transform 0.2s, box-shadow 0.2s',
              }}
              onMouseOver={e => {
                e.currentTarget.style.transform = 'scale(1.02)';
                e.currentTarget.style.boxShadow = '0 4px 20px rgba(220, 38, 38, 0.4)';
              }}
              onMouseOut={e => {
                e.currentTarget.style.transform = 'scale(1)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 28 }}>👑</span>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>Dashboard Admin</div>
                  <div style={{ fontSize: 12, opacity: 0.9 }}>Gestione tester, token, feedback</div>
                </div>
              </div>
              <span style={{ fontSize: 20 }}>→</span>
            </a>
          </div>
        )}

        {/* SEZIONE LEGAL */}
        <div style={{ marginBottom: 16, padding: 16, background: '#f9fafb', borderRadius: 12, border: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 12 }}>📄 DOCUMENTI LEGALI</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <a 
              href="/legal/privacy" 
              style={{ 
                fontSize: 13, 
                color: '#2563eb', 
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              Privacy Policy
            </a>
            <a 
              href="/legal/terms" 
              style={{ 
                fontSize: 13, 
                color: '#2563eb', 
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              Termini di Servizio
            </a>
            <a 
              href="/legal/cookies" 
              style={{ 
                fontSize: 13, 
                color: '#2563eb', 
                textDecoration: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              Cookie Policy
            </a>
          </div>
        </div>

        {/* Versione App */}
        <div style={{ padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          REPING Beta 1.0 • 2025
        </div>
      </div>
    </>
  );
}

// Sub-component per opzione pagina iniziale
function HomePageOption({ 
  mode, currentMode, onChange, title, description, icon 
}: { 
  mode: 'chat' | 'dashboard'; 
  currentMode: 'chat' | 'dashboard'; 
  onChange: (m: 'chat' | 'dashboard') => void; 
  title: string; 
  description: string; 
  icon: string;
}) {
  const isActive = mode === currentMode;
  return (
    <button
      onClick={() => onChange(mode)}
      style={{
        padding: 16, borderRadius: 12,
        border: isActive ? '2px solid #2563eb' : '1px solid #e5e7eb',
        background: isActive ? '#eff6ff' : 'white',
        cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 28 }}>{icon}</div>
        <div>
          <div style={{ fontWeight: 600, color: '#111827', marginBottom: 2 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#6b7280' }}>{description}</div>
        </div>
        {isActive && <div style={{ marginLeft: 'auto', color: '#2563eb', fontWeight: 600 }}>✓</div>}
      </div>
    </button>
  );
}

// cache bust 1764710095
