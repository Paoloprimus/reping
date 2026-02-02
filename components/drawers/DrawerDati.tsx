// components/drawers/DrawerDati.tsx
// Estratto da components/Drawers.tsx per mantenibilità

"use client";
import { useState } from "react";
import ClientSearchBox from "../ClientSearchBox";

interface DrawerDatiProps {
  onClose: () => void;
}

export default function DrawerDati({ onClose }: DrawerDatiProps) {
  const [tab, setTab] = useState<'clienti' | 'prodotti' | 'uscite'>('uscite');
  const [showClientSearch, setShowClientSearch] = useState(false);
  
  function goToClientDetail(clientId: string) {
    onClose();
    window.location.href = `/clients/${clientId}`;
  }

  function goQuickAdd() {
    onClose();
    window.location.href = '/tools/quick-add-client';
  }
  
  function goClientsList() {
    onClose();
    window.location.href = "/clients";
  }

  function goImportClients() {
    onClose();
    window.location.href = "/tools/import-clients";
  }

  function goPlanning() {
    onClose();
    window.location.href = "/planning";
  }

  function goProductsList() {
    onClose();
    window.location.href = "/products";
  }

  function goQuickAddProduct() {
    onClose();
    window.location.href = "/tools/quick-add-product";
  }

  function goImportProducts() {
    onClose();
    window.location.href = "/tools/import-products";
  }

  function downloadCSVTemplate() {
    const headers = [
      'name', 'contact_name', 'city', 'address', 'tipo_locale',
      'phone', 'email', 'vat_number', 'notes'
    ];
    
    const exampleRow = [
      'Bar Centrale', 'Mario Rossi', 'Milano', 'Via Roma 123', 'Bar',
      '0212345678', 'info@barcentrale.it', '12345678901',
      'Cliente storico, preferisce consegne al mattino'
    ];
    
    const csvContent = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', 'template-clienti.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function downloadProductsCSVTemplate() {
    const headers = [
      'codice', 'descrizione_articolo', 'title', 'sku', 'unita_misura',
      'giacenza', 'base_price', 'sconto_merce', 'sconto_fattura', 'is_active'
    ];
    
    const exampleRow = [
      'ART001', 'Vino Rosso DOC Superiore 75cl', 'Vino Rosso DOC',
      '8001234567890', 'BT', '100', '12.50', '1+1 gratis', '10', 'true'
    ];
    
    const csvContent = [headers.join(','), exampleRow.join(',')].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.setAttribute('href', URL.createObjectURL(blob));
    link.setAttribute('download', 'template-prodotti.csv');
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const tabStyle = (isActive: boolean) => ({
    flex: 1,
    padding: '12px 16px',
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    color: isActive ? '#2563eb' : '#6b7280',
    borderBottom: isActive ? '2px solid #2563eb' : '2px solid transparent',
    transition: 'all 0.15s',
  });

  return (
    <>
      <div className="topbar">
        <button className="iconbtn" onClick={onClose}>Chiudi</button>
        <div className="title">Gestione</div>
      </div>

      {/* Tabs */}
      {/* 🔒 BETA: Tab PRODOTTI nascosto - riattivare per MULTIAGENT */}
      <div style={{ display: 'flex', borderBottom: '1px solid #e5e7eb' }}>
        <button onClick={() => setTab('uscite')} style={tabStyle(tab === 'uscite')}>USCITE</button>
        <button onClick={() => setTab('clienti')} style={tabStyle(tab === 'clienti')}>CLIENTI</button>
        {/* <button onClick={() => setTab('prodotti')} style={tabStyle(tab === 'prodotti')}>PRODOTTI</button> */}
      </div>

      <div className="list" style={{ padding: 16 }}>
        {tab === 'clienti' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn" onClick={goClientsList}>📋 Lista clienti</button>
            
            {/* Accordion ricerca cliente */}
            <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <button 
                className="btn"
                onClick={() => setShowClientSearch(!showClientSearch)}
                style={{ 
                  width: '100%', 
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center',
                  background: showClientSearch ? '#f3f4f6' : 'white',
                  borderRadius: 0,
                  margin: 0,
                }}
              >
                <span>🔍 Cerca scheda cliente</span>
                <span style={{ fontSize: 12 }}>{showClientSearch ? '▲' : '▼'}</span>
              </button>
              
              {showClientSearch && (
                <div style={{ padding: 12, background: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
                  <ClientSearchBox 
                    onSelect={goToClientDetail}
                    placeholder="Cerca per nome, città o tipo..."
                  />
                </div>
              )}
            </div>
            
            <button className="btn" onClick={goQuickAdd} style={{ background: '#2563eb', color: 'white', border: 'none' }}>
              ➕ Aggiungi singolo
            </button>
            <button className="btn" onClick={goImportClients}>📥 Importa lista</button>
            <button className="btn" onClick={downloadCSVTemplate}>📄 Scarica template CSV</button>
          </div>
        )}

        {/* 🔒 BETA: Sezione PRODOTTI nascosta - riattivare per MULTIAGENT
        {tab === 'prodotti' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn" onClick={goProductsList}>📦 Lista prodotti</button>
            <button className="btn" onClick={goQuickAddProduct} style={{ background: '#2563eb', color: 'white', border: 'none' }}>
              ➕ Aggiungi singolo
            </button>
            <button className="btn" onClick={goImportProducts}>📥 Importa lista</button>
            <button className="btn" onClick={downloadProductsCSVTemplate}>📄 Scarica template CSV</button>
          </div>
        )}
        */}

        {tab === 'uscite' && (
          <div style={{ display: 'grid', gap: 8 }}>
            <button className="btn" onClick={() => { onClose(); window.location.href = '/visits'; }}>
              📅 Visite & Chiamate
            </button>
            <button className="btn" onClick={() => { onClose(); window.location.href = '/tools/add-visit'; }} style={{ background: '#2563eb', color: 'white', border: 'none' }}>
              ➕ Nuova visita
            </button>
            <button className="btn" onClick={goPlanning} style={{ background: '#10b981', color: 'white', border: 'none' }}>
              🗺️ Planning Visite
            </button>
          </div>
        )}
      </div>
    </>
  );
}

