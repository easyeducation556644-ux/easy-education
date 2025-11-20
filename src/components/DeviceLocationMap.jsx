import { useEffect, useRef } from 'react'

export function DeviceLocationMap({ latitude, longitude, city, country }) {
  const mapRef = useRef(null)
  const mapInstanceRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current || !latitude || !longitude || latitude === 0 || longitude === 0) return

    const loadGoogleMaps = () => {
      if (window.google && window.google.maps) {
        initMap()
        return
      }

      if (document.querySelector('script[src*="maps.googleapis.com"]')) {
        const checkInterval = setInterval(() => {
          if (window.google && window.google.maps) {
            clearInterval(checkInterval)
            initMap()
          }
        }, 100)
        return
      }

      const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
      
      if (!apiKey) {
        console.warn('Google Maps API key not configured. Set VITE_GOOGLE_MAPS_API_KEY environment variable.')
        return
      }

      const script = document.createElement('script')
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`
      script.async = true
      script.defer = true
      script.onload = () => {
        initMap()
      }
      script.onerror = () => {
        console.error('Failed to load Google Maps script')
      }
      document.head.appendChild(script)
    }

    const initMap = () => {
      if (!window.google || !window.google.maps || !mapRef.current) return

      const position = { lat: latitude, lng: longitude }

      const map = new window.google.maps.Map(mapRef.current, {
        center: position,
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
      })

      new window.google.maps.Marker({
        position: position,
        map: map,
        title: `${city}, ${country}`,
        animation: window.google.maps.Animation.DROP,
      })

      mapInstanceRef.current = map
    }

    loadGoogleMaps()

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current = null
      }
    }
  }, [latitude, longitude, city, country])

  const hasValidLocation = latitude && longitude && latitude !== 0 && longitude !== 0
  const hasApiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  if (!hasValidLocation) {
    return (
      <div className="w-full h-64 bg-muted rounded-lg flex items-center justify-center">
        <p className="text-sm text-muted-foreground">Location data not available</p>
      </div>
    )
  }

  if (!hasApiKey) {
    return (
      <div className="w-full h-64 bg-muted rounded-lg flex flex-col items-center justify-center gap-3 p-4">
        <p className="text-sm text-muted-foreground text-center">
          Google Maps API key not configured
        </p>
        <a
          href={`https://www.google.com/maps?q=${latitude},${longitude}`}
          target="_blank"
          rel="noopener noreferrer"
          className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
        >
          View on Google Maps
        </a>
      </div>
    )
  }

  return (
    <div className="w-full h-64 bg-muted rounded-lg overflow-hidden border border-border">
      <div ref={mapRef} className="w-full h-full" />
    </div>
  )
}
