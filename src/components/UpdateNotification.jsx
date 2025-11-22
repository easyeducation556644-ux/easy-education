import { useState, useEffect } from 'react';
import { updateServiceWorker } from '../lib/pwa';

export default function UpdateNotification() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [registration, setRegistration] = useState(null);
  const [isVersionMismatch, setIsVersionMismatch] = useState(false);
  const [dismissedVersion, setDismissedVersion] = useState(null);

  useEffect(() => {
    const checkVersion = async () => {
      try {
        const response = await fetch('/api/version?t=' + Date.now());
        const data = await response.json();
        const localVersion = localStorage.getItem('appVersion');
        const dismissed = localStorage.getItem('dismissedUpdateVersion');
        
        if (localVersion && localVersion !== data.version) {
          if (dismissed !== data.version) {
            console.log('Version mismatch detected:', localVersion, '!==', data.version);
            setIsVersionMismatch(true);
            setShowUpdate(true);
            setDismissedVersion(null);
          }
        } else {
          setIsVersionMismatch(false);
          if (showUpdate && !registration) {
            setShowUpdate(false);
          }
        }
        
        localStorage.setItem('appVersion', data.version);
      } catch (error) {
        console.error('Failed to check version:', error);
      }
    };

    checkVersion();
    const versionCheckInterval = setInterval(checkVersion, 120000);

    const handleUpdateAvailable = (event) => {
      console.log('Update available event received');
      setRegistration(event.detail.registration);
      setShowUpdate(true);
    };

    const handleReloadMessage = (event) => {
      if (event.data && (event.data.type === 'RELOAD_PAGE' || event.data.type === 'FORCE_UPDATE')) {
        console.log('Reload/force update message received from service worker');
        window.location.reload();
      }
      if (event.data && event.data.type === 'VERSION_CHECK_RESULT' && event.data.needsUpdate) {
        console.log('Version update needed');
        setIsVersionMismatch(true);
        setShowUpdate(true);
      }
    };

    window.addEventListener('swUpdateAvailable', handleUpdateAvailable);
    
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleReloadMessage);
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({ type: 'CHECK_UPDATE' });
      }
    }

    return () => {
      clearInterval(versionCheckInterval);
      window.removeEventListener('swUpdateAvailable', handleUpdateAvailable);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleReloadMessage);
      }
    };
  }, []);

  const handleUpdate = async () => {
    console.log('🔄 Starting update process...');
    setShowUpdate(false);
    
    localStorage.removeItem('dismissedUpdateVersion');
    
    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
          await reg.unregister();
        }
        console.log('✅ Service workers unregistered');
      }
      
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        console.log('✅ All caches cleared');
      }
      
      localStorage.removeItem('appVersion');
      console.log('✅ Version cleared, reloading...');
      
      window.location.reload(true);
    } catch (error) {
      console.error('Error during update:', error);
      window.location.reload(true);
    }
  };

  const handleDismiss = async () => {
    if (isVersionMismatch) {
      return;
    }
    
    try {
      const response = await fetch('/api/version');
      const data = await response.json();
      localStorage.setItem('dismissedUpdateVersion', data.version);
      setDismissedVersion(data.version);
    } catch (error) {
      console.error('Failed to save dismissed version:', error);
    }
    
    setShowUpdate(false);
  };

  if (!showUpdate) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 animate-in slide-in-from-bottom-5">
      <div className={`${isVersionMismatch ? 'bg-red-600' : 'bg-blue-600'} text-white rounded-lg shadow-2xl p-4 border ${isVersionMismatch ? 'border-red-500' : 'border-blue-500'}`}>
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg 
              className="w-6 h-6" 
              fill="none" 
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d={isVersionMismatch ? "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" : "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"}
              />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm mb-1">
              {isVersionMismatch ? 'গুরুত্বপূর্ণ আপডেট প্রয়োজন!' : 'নতুন আপডেট উপলব্ধ!'}
            </h3>
            <p className={`text-sm mb-3 ${isVersionMismatch ? 'text-red-100' : 'text-blue-100'}`}>
              {isVersionMismatch 
                ? 'আপনার অ্যাপটি পুরানো সংস্করণে চলছে। Login এবং অন্যান্য ফিচার ঠিকভাবে কাজ করার জন্য এখনই আপডেট করুন।'
                : 'আপনার অভিজ্ঞতা উন্নত করতে একটি নতুন সংস্করণ পাওয়া গেছে। এখনই আপডেট করুন।'
              }
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleUpdate}
                className={`flex-1 font-medium py-2 px-4 rounded-md text-sm transition-colors ${
                  isVersionMismatch 
                    ? 'bg-white text-red-600 hover:bg-red-50' 
                    : 'bg-white text-blue-600 hover:bg-blue-50'
                }`}
              >
                এখনই আপডেট করুন
              </button>
              {!isVersionMismatch && (
                <button
                  onClick={handleDismiss}
                  className="px-4 py-2 text-sm text-blue-100 hover:text-white transition-colors"
                >
                  পরে
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
