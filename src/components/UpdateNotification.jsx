import { useState, useEffect } from 'react';
import { hasNativeDownloader } from '../lib/nativeAndroid';

export default function UpdateNotification() {
  const [showUpdate, setShowUpdate] = useState(false);
  const [registration, setRegistration] = useState(null);
  const [isVersionMismatch, setIsVersionMismatch] = useState(false);
  const nativeApp = hasNativeDownloader();

  useEffect(() => {
    if (nativeApp) {
      setShowUpdate(false);
      return;
    }

    const updateInProgress = sessionStorage.getItem('updateInProgress');
    const lastUpdateTimestamp = localStorage.getItem('lastUpdateTimestamp');
    const timeSinceUpdate = lastUpdateTimestamp ? Date.now() - parseInt(lastUpdateTimestamp) : Infinity;

    if (updateInProgress === 'true' || timeSinceUpdate < 10000) {
      sessionStorage.removeItem('updateInProgress');
      return;
    }

    const checkVersion = async () => {
      try {
        const recentUpdate = localStorage.getItem('lastUpdateTimestamp');
        const timeSince = recentUpdate ? Date.now() - parseInt(recentUpdate) : Infinity;
        if (timeSince < 10000) return;

        const response = await fetch('/api/version?t=' + Date.now());
        const data = await response.json();
        const localVersion = localStorage.getItem('appVersion');
        const dismissed = localStorage.getItem('dismissedUpdateVersion');

        if (localVersion && localVersion !== data.version) {
          if (dismissed !== data.version) {
            setIsVersionMismatch(true);
            setShowUpdate(true);
          }
        } else {
          setIsVersionMismatch(false);
          if (!registration) setShowUpdate(false);
        }

        localStorage.setItem('appVersion', data.version);
      } catch (error) {
        console.error('Failed to check version:', error);
      }
    };

    checkVersion();
    const versionCheckInterval = setInterval(checkVersion, 120000);

    const handleUpdateAvailable = (event) => {
      const recentUpdate = localStorage.getItem('lastUpdateTimestamp');
      const timeSince = recentUpdate ? Date.now() - parseInt(recentUpdate) : Infinity;
      if (timeSince < 10000) return;
      setRegistration(event.detail.registration);
      setIsVersionMismatch(false);
      setShowUpdate(true);
    };

    const handleReloadMessage = (event) => {
      if (event.data && (event.data.type === 'RELOAD_PAGE' || event.data.type === 'FORCE_UPDATE')) {
        window.location.reload();
      }
      if (event.data && event.data.type === 'VERSION_CHECK_RESULT' && event.data.needsUpdate) {
        const recentUpdate = localStorage.getItem('lastUpdateTimestamp');
        const timeSince = recentUpdate ? Date.now() - parseInt(recentUpdate) : Infinity;
        if (timeSince < 10000) return;
        setIsVersionMismatch(true);
        setShowUpdate(true);
      }
    };

    window.addEventListener('swUpdateAvailable', handleUpdateAvailable);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleReloadMessage);
      navigator.serviceWorker.controller?.postMessage({ type: 'CHECK_UPDATE' });
    }

    return () => {
      clearInterval(versionCheckInterval);
      window.removeEventListener('swUpdateAvailable', handleUpdateAvailable);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleReloadMessage);
      }
    };
  }, [nativeApp, registration]);

  const handleUpdate = async () => {
    setShowUpdate(false);
    sessionStorage.setItem('updateInProgress', 'true');
    localStorage.setItem('lastUpdateTimestamp', Date.now().toString());
    localStorage.removeItem('dismissedUpdateVersion');

    try {
      if ('serviceWorker' in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) await reg.unregister();
      }
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(
          cacheNames
            .filter(name => name !== 'easy-education-offline-v1')
            .map(name => caches.delete(name))
        );
      }
      localStorage.removeItem('appVersion');
      window.location.href = window.location.href.split('?')[0] + '?v=' + Date.now();
    } catch (error) {
      console.error('Error during update:', error);
      window.location.href = window.location.href.split('?')[0] + '?v=' + Date.now();
    }
  };

  const handleDismiss = async () => {
    if (isVersionMismatch) return;
    try {
      const response = await fetch('/api/version');
      const data = await response.json();
      localStorage.setItem('dismissedUpdateVersion', data.version);
    } catch (error) {
      console.error('Failed to save dismissed version:', error);
    }
    setShowUpdate(false);
  };

  if (nativeApp || !showUpdate) return null;

  return (
    <div className="fixed bottom-20 left-4 right-4 md:left-auto md:right-4 md:max-w-md z-50 animate-in slide-in-from-bottom-5">
      <div className={`relative ${isVersionMismatch ? 'bg-red-600' : 'bg-blue-600'} text-white rounded-lg shadow-2xl p-4 border ${isVersionMismatch ? 'border-red-500' : 'border-blue-500'}`}>
        {!isVersionMismatch && (
          <button
            onClick={handleDismiss}
            className="absolute top-2 right-2 text-white/70 hover:text-white transition-colors p-1 rounded-full hover:bg-white/10"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        <div className="flex items-start gap-3">
          <div className="flex-shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isVersionMismatch ? "M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" : "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"} />
            </svg>
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <h3 className="font-semibold text-sm mb-1">
              {isVersionMismatch ? 'গুরুত্বপূর্ণ আপডেট প্রয়োজন!' : 'নতুন আপডেট উপলব্ধ!'}
            </h3>
            <p className={`text-sm mb-3 ${isVersionMismatch ? 'text-red-100' : 'text-blue-100'}`}>
              {isVersionMismatch
                ? 'আপনার ওয়েব অ্যাপটি পুরানো সংস্করণে চলছে। এখনই আপডেট করুন।'
                : 'আপনার অভিজ্ঞতা উন্নত করতে একটি নতুন ওয়েব সংস্করণ পাওয়া গেছে। এখনই আপডেট করুন।'}
            </p>
            <button
              onClick={handleUpdate}
              className={`w-full font-medium py-2 px-4 rounded-md text-sm transition-colors ${isVersionMismatch ? 'bg-white text-red-600 hover:bg-red-50' : 'bg-white text-blue-600 hover:bg-blue-50'}`}
            >
              এখনই আপডেট করুন
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
