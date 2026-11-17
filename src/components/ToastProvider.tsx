import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { RichText } from './RichText';

type Tone = 'success' | 'error' | 'info' | 'warning';
interface ToastApi { show: (message: string, tone?: Tone) => void }

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; tone: Tone } | null>(null);
  const show = useCallback((message: string, tone: Tone = 'info') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 4500);
  }, []);
  const value = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast ? <div className={`toast toast-${toast.tone}`} role="status"><RichText text={toast.message} /></div> : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
