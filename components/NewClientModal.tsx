// components/NewClientModal.tsx
"use client";

import { useEffect, useState } from "react";

interface Props {
  show: boolean;
  onClose: () => void;
}

export default function NewClientModal({ show, onClose }: Props) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // Detect mobile
    setIsMobile(window.innerWidth < 768);
  }, []);

  if (!show) return null;

  const handleVoice = () => {
    onClose();
    // Vai direttamente alla pagina quick-add con parametro per avviare voce
    window.location.href = '/tools/quick-add-client?voice=1';
  };

  const handleForm = () => {
    onClose();
    window.location.href = '/tools/quick-add-client';
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0, 0, 0, 0.6)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'fadeIn 0.2s ease-out',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white',
          borderRadius: 20,
          width: '100%',
          maxWidth: 400,
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
          animation: 'slideUp 0.3s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '24px 24px 20px',
            background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
            color: 'white',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
              ➕ Nuovo Cliente
            </h2>
            <button
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: 'none',
                background: 'rgba(255,255,255,0.2)',
                color: 'white',
                fontSize: 18,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              ✕
            </button>
          </div>
          <p style={{ fontSize: 14, margin: '8px 0 0', opacity: 0.9 }}>
            Come vuoi aggiungerlo?
          </p>
        </div>

        {/* Body */}
        <div style={{ padding: 24 }}>
          {/* Opzione Vocale - CONSIGLIATA */}
          <button
            onClick={handleVoice}
            style={{
              width: '100%',
              padding: '20px 24px',
              marginBottom: 12,
              background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
              border: 'none',
              borderRadius: 16,
              cursor: 'pointer',
              textAlign: 'left',
              position: 'relative',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
              transition: 'transform 0.2s, box-shadow 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-2px)';
              e.currentTarget.style.boxShadow = '0 6px 20px rgba(37, 99, 235, 0.4)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.3)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'rgba(255, 255, 255, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  flexShrink: 0,
                }}
              >
                🎙️
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'white', marginBottom: 4 }}>
                  Creazione Vocale
                </div>
                <div style={{ fontSize: 13, color: 'rgba(255, 255, 255, 0.9)' }}>
                  Guida passo-passo
                </div>
              </div>
            </div>
          </button>

          {/* Opzione Form */}
          <button
            onClick={handleForm}
            style={{
              width: '100%',
              padding: '18px 24px',
              background: 'white',
              border: '2px solid #e5e7eb',
              borderRadius: 16,
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.2s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = '#9ca3af';
              e.currentTarget.style.background = '#f9fafb';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = '#e5e7eb';
              e.currentTarget.style.background = 'white';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  background: '#f3f4f6',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 24,
                  flexShrink: 0,
                }}
              >
                ✏️
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 600, color: '#111827', marginBottom: 2 }}>
                  Form Manuale
                </div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>
                  Compila tutti i campi a mano
                </div>
              </div>
            </div>
          </button>

          {/* Info box */}
          {isMobile && (
            <div
              style={{
                marginTop: 16,
                padding: 12,
                background: '#eff6ff',
                border: '1px solid #3b82f6',
                borderRadius: 12,
                fontSize: 12,
                color: '#1e40af',
                display: 'flex',
                gap: 8,
              }}
            >
              <span>💡</span>
              <span>
                <strong>Tip:</strong> La creazione vocale è perfetta se sei in movimento o hai le mani occupate!
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Animazioni CSS */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </div>
  );
}

