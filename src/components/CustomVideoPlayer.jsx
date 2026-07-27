import { useState, useRef, useEffect, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Loader2,
  AlertCircle,
  RotateCw,
  RotateCcw,
} from "lucide-react"

const YOUTUBE_REGEX =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/
const DRIVE_REGEX =
  /drive\.google\.com\/(?:file\/d\/|open\?id=)([a-zA-Z0-9_-]+)/
const DAILYMOTION_REGEX =
  /(?:dailymotion\.com\/video\/|dai\.ly\/)([a-zA-Z0-9]+)/
const RUMBLE_REGEX =
  /rumble\.com\/(?:embed\/)?(v[a-zA-Z0-9]+)(?:[-/?#.]|$)/
const DEFAULT_PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

let youtubeApiPromise

function loadYouTubeIframeApi() {
  if (window.YT?.Player) return Promise.resolve(window.YT)
  if (youtubeApiPromise) return youtubeApiPromise

  youtubeApiPromise = new Promise((resolve, reject) => {
    const previousReadyHandler = window.onYouTubeIframeAPIReady
    const handleReady = () => {
      try {
        previousReadyHandler?.()
      } catch {
        // Another player callback must not block this player.
      }
      resolve(window.YT)
    }

    window.onYouTubeIframeAPIReady = handleReady

    let script = document.querySelector(
      'script[src="https://www.youtube.com/iframe_api"]',
    )
    let shouldAppend = false

    if (!script) {
      script = document.createElement("script")
      script.src = "https://www.youtube.com/iframe_api"
      script.async = true
      shouldAppend = true
    }

    script.addEventListener(
      "error",
      () => {
        youtubeApiPromise = null
        reject(new Error("Unable to load YouTube player API"))
      },
      { once: true },
    )

    if (shouldAppend) {
      document.head.appendChild(script)
    }
  })

  return youtubeApiPromise
}

let hlsApiPromise

function loadHlsApi() {
  if (window.Hls) return Promise.resolve(window.Hls)
  if (hlsApiPromise) return hlsApiPromise

  hlsApiPromise = new Promise((resolve, reject) => {
    let script = document.querySelector('script[src*="hls.js"]')
    let shouldAppend = false

    const handleLoad = () => {
      if (window.Hls) {
        resolve(window.Hls)
      } else {
        hlsApiPromise = null
        reject(new Error("HLS library did not initialize"))
      }
    }
    const handleError = () => {
      hlsApiPromise = null
      reject(new Error("Unable to load HLS library"))
    }

    if (!script) {
      script = document.createElement("script")
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@latest"
      script.async = true
      shouldAppend = true
    }

    script.addEventListener("load", handleLoad, { once: true })
    script.addEventListener("error", handleError, { once: true })

    if (shouldAppend) {
      document.head.appendChild(script)
    }
  })

  return hlsApiPromise
}

export default function CustomVideoPlayer({ url, onNext, onPrevious }) {
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(100)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffered, setBuffered] = useState(0)
  const [fullscreen, setFullscreen] = useState(false)
  const [showControls, setShowControls] = useState(true)
  const [playbackRate, setPlaybackRate] = useState(1)
  const [showSettings, setShowSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [hasStartedPlaying, setHasStartedPlaying] = useState(false)
  const [isSeeking, setIsSeeking] = useState(false)
  const [showVolumeSlider, setShowVolumeSlider] = useState(false)
  const [isBuffering, setIsBuffering] = useState(false)
  const [isSeekingLoading, setIsSeekingLoading] = useState(false)
  const [showVolumeIndicator, setShowVolumeIndicator] = useState(false)
  const [isSwiping, setIsSwiping] = useState(false)
  const [swipeStartY, setSwipeStartY] = useState(0)
  const [swipeStartX, setSwipeStartX] = useState(0)
  const [swipeType, setSwipeType] = useState(null)
  const [seekDelta, setSeekDelta] = useState(0)
  const [showSeekIndicator, setShowSeekIndicator] = useState(false)
  const [showDoubleTapLeft, setShowDoubleTapLeft] = useState(false)
  const [showDoubleTapRight, setShowDoubleTapRight] = useState(false)
  const [doubleTapCount, setDoubleTapCount] = useState({ left: 0, right: 0 })
  const [playbackRates, setPlaybackRates] = useState(DEFAULT_PLAYBACK_RATES)

  const provider = useMemo(() => {
    if (!url) return "none"
    if (YOUTUBE_REGEX.test(url)) return "youtube"
    if (DRIVE_REGEX.test(url)) return "drive"
    if (DAILYMOTION_REGEX.test(url)) return "dailymotion"
    if (RUMBLE_REGEX.test(url)) return "rumble"
    return "native"
  }, [url])
  const isYouTube = provider === "youtube"
  const isDrive = provider === "drive"
  const isDailymotion = provider === "dailymotion"
  const isRumble = provider === "rumble"

  const videoRef = useRef(null)
  const containerRef = useRef(null)
  const youtubeContainerRef = useRef(null)
  const playerRef = useRef(null)
  const controlsTimeoutRef = useRef(null)
  const hlsRef = useRef(null)
  const lastTapRef = useRef({ time: 0, side: null })
  const updateIntervalRef = useRef(null)
  const mouseMoveTimeoutRef = useRef(null)
  const volumeSliderRef = useRef(null)
  const loadTimeoutRef = useRef(null)
  const hlsTimeoutRef = useRef(null)
  const pendingSeekRef = useRef(0)
  const onNextRef = useRef(onNext)
  const volumeRef = useRef(volume)
  const playbackRateRef = useRef(playbackRate)

  useEffect(() => {
    onNextRef.current = onNext
  }, [onNext])

  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  useEffect(() => {
    playbackRateRef.current = playbackRate
  }, [playbackRate])

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setBuffered(0)
    setHasStartedPlaying(false)
    setIsBuffering(false)
    setIsSeekingLoading(false)
    setIsSeeking(false)
    setShowSettings(false)
    setPlaybackRates(DEFAULT_PLAYBACK_RATES)
    pendingSeekRef.current = 0
    setError(null)
    setLoading(Boolean(url) && !isDrive && !isDailymotion && !isRumble)
  }, [url, isDrive, isDailymotion, isRumble])

  const getYouTubeId = (url) => {
    const match = url.match(YOUTUBE_REGEX)
    return match ? match[1] : null
  }

  const getDriveId = (url) => {
    const match = url.match(DRIVE_REGEX)
    return match ? match[1] : null
  }

  const getDailymotionId = (url) => {
    const match = url.match(DAILYMOTION_REGEX)
    return match ? match[1] : null
  }

  const getRumbleId = (url) => {
    const match = url.match(RUMBLE_REGEX)
    return match ? match[1] : null
  }

  const handleVolumeChange = (newVolume) => {
    const roundedVolume = Math.round(newVolume)
    setVolume(roundedVolume)
    if (isYouTube && playerRef.current) {
      playerRef.current.setVolume(roundedVolume)
    } else if (videoRef.current) {
      videoRef.current.volume = roundedVolume / 100
    }
  }

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (volumeSliderRef.current && !volumeSliderRef.current.contains(event.target)) {
        setShowVolumeSlider(false)
      }
    }

    if (showVolumeSlider) {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("touchstart", handleClickOutside)
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("touchstart", handleClickOutside)
    }
  }, [showVolumeSlider])

  useEffect(() => {
    if (!isYouTube || !url) return

    const videoId = getYouTubeId(url)
    if (!videoId) {
      setError("Invalid YouTube URL")
      setLoading(false)
      return
    }

    let cancelled = false
    let youtubePlayer = null

    const clearReadyTimeout = () => {
      if (loadTimeoutRef.current) {
        clearTimeout(loadTimeoutRef.current)
        loadTimeoutRef.current = null
      }
    }

    const syncPlayerMetrics = (target) => {
      try {
        const nextDuration = target.getDuration?.()
        const nextTime = target.getCurrentTime?.()
        const loadedFraction = target.getVideoLoadedFraction?.()

        if (Number.isFinite(nextDuration) && nextDuration > 0) {
          setDuration(nextDuration)
        }
        if (!isSeeking && Number.isFinite(nextTime) && nextTime >= 0) {
          setCurrentTime(nextTime)
        }
        if (Number.isFinite(loadedFraction)) {
          setBuffered(Math.min(100, Math.max(0, loadedFraction * 100)))
        }
      } catch {
        // The iframe may be between states while switching videos.
      }
    }

    loadTimeoutRef.current = setTimeout(() => {
      if (!cancelled && !playerRef.current) {
        setError("Failed to load video player. Please refresh the page.")
        setLoading(false)
      }
    }, 12000)

    loadYouTubeIframeApi()
      .then((YT) => {
        if (cancelled || !youtubeContainerRef.current) return

        youtubePlayer = new YT.Player(youtubeContainerRef.current, {
          videoId,
          playerVars: {
            autoplay: 1,
            controls: 0,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            fs: 0,
            iv_load_policy: 3,
            disablekb: 1,
            playsinline: 1,
            origin: window.location.origin,
            widget_referrer: window.location.origin,
            enablejsapi: 1,
            cc_load_policy: 0,
            autohide: 1,
            color: "white",
            branding: 0,
          },
          events: {
            onReady: (event) => {
              if (cancelled) {
                event.target.destroy?.()
                return
              }

              clearReadyTimeout()
              playerRef.current = event.target
              event.target.setVolume(volumeRef.current)

              const availableRates =
                event.target.getAvailablePlaybackRates?.() || []
              if (availableRates.length > 0) {
                setPlaybackRates(availableRates)
              }
              if (availableRates.includes(playbackRateRef.current)) {
                event.target.setPlaybackRate(playbackRateRef.current)
              } else {
                setPlaybackRate(1)
              }

              syncPlayerMetrics(event.target)
              setLoading(false)
              event.target.playVideo()
            },
            onStateChange: (event) => {
              if (cancelled) return

              const state = event.data
              const isPlaying = state === YT.PlayerState.PLAYING
              const isBufferingState = state === YT.PlayerState.BUFFERING

              setPlaying(isPlaying)
              setIsBuffering(isBufferingState)
              syncPlayerMetrics(event.target)

              if (!isBufferingState) {
                setIsSeekingLoading(false)
              }
              if (isPlaying) {
                setHasStartedPlaying(true)
                setLoading(false)
              }
              if (state === YT.PlayerState.ENDED) {
                setPlaying(false)
                onNextRef.current?.()
              }
            },
            onPlaybackRateChange: (event) => {
              if (!cancelled && Number.isFinite(event.data)) {
                setPlaybackRate(event.data)
              }
            },
            onAutoplayBlocked: () => {
              if (cancelled) return
              setPlaying(false)
              setIsBuffering(false)
              setLoading(false)
              setShowControls(true)
            },
            onError: (event) => {
              if (cancelled) return
              console.error("YouTube player error:", event.data)
              clearReadyTimeout()
              setError("Failed to load video")
              setLoading(false)
            },
          },
        })
      })
      .catch(() => {
        if (cancelled) return
        clearReadyTimeout()
        setError("Failed to load YouTube player. Please check your connection.")
        setLoading(false)
      })

    return () => {
      cancelled = true
      clearReadyTimeout()
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current)
        updateIntervalRef.current = null
      }
      if (youtubePlayer?.destroy) {
        youtubePlayer.destroy()
      }
      if (playerRef.current === youtubePlayer) {
        playerRef.current = null
      }
    }
  }, [isYouTube, url])

  useEffect(() => {
    if (!isYouTube || !playerRef.current) return

    const syncPlayerMetrics = () => {
      const player = playerRef.current
      if (!player) return

      try {
        if (!isSeeking) {
          const time = player.getCurrentTime?.()
          if (Number.isFinite(time) && time >= 0) {
            setCurrentTime(time)
          }
        }

        const nextDuration = player.getDuration?.()
        if (Number.isFinite(nextDuration) && nextDuration > 0) {
          setDuration(nextDuration)
        }

        const loadedFraction = player.getVideoLoadedFraction?.()
        if (Number.isFinite(loadedFraction)) {
          setBuffered(Math.min(100, Math.max(0, loadedFraction * 100)))
        }
      } catch {
        // Player can briefly be unavailable during navigation.
      }
    }

    syncPlayerMetrics()

    if (playing) {
      updateIntervalRef.current = setInterval(syncPlayerMetrics, 200)
    } else {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current)
        updateIntervalRef.current = null
      }
    }

    return () => {
      if (updateIntervalRef.current) {
        clearInterval(updateIntervalRef.current)
        updateIntervalRef.current = null
      }
    }
  }, [isYouTube, playing, isSeeking])

  useEffect(() => {
    if (isYouTube || isDrive || isDailymotion || isRumble || !url || !videoRef.current) return

    const video = videoRef.current
    let cancelled = false

    if (url.includes(".m3u8")) {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url
        video.play().catch(() => {
          // Autoplay failed, user interaction needed
        })
        setLoading(false)
      } else {
        hlsTimeoutRef.current = setTimeout(() => {
          if (!cancelled) {
            setError("Failed to load HLS player. Please refresh the page.")
            setLoading(false)
          }
        }, 10000)

        loadHlsApi()
          .then((Hls) => {
            if (cancelled) return

          if (hlsTimeoutRef.current) {
            clearTimeout(hlsTimeoutRef.current)
            hlsTimeoutRef.current = null
          }

          try {
            if (Hls.isSupported()) {
              const hls = new Hls({
                startFragPrefetch: true,
                maxBufferLength: 30,
                backBufferLength: 30,
              })
              let recoveryAttempts = 0
              hlsRef.current = hls
              hls.loadSource(url)
              hls.attachMedia(video)
              hls.on(Hls.Events.MANIFEST_PARSED, () => {
                recoveryAttempts = 0
                setLoading(false)
                video.play().catch(() => {
                  // Autoplay failed
                })
              })
              hls.on(Hls.Events.ERROR, (_event, data) => {
                if (!data.fatal || cancelled) return

                if (
                  data.type === Hls.ErrorTypes.NETWORK_ERROR &&
                  recoveryAttempts < 2
                ) {
                  recoveryAttempts += 1
                  hls.startLoad()
                  return
                }

                if (
                  data.type === Hls.ErrorTypes.MEDIA_ERROR &&
                  recoveryAttempts < 2
                ) {
                  recoveryAttempts += 1
                  hls.recoverMediaError()
                  return
                }

                setError("Failed to load video")
                setLoading(false)
              })
            } else {
              setError("HLS not supported in this browser")
              setLoading(false)
            }
          } catch {
            setError("Failed to initialize HLS player")
            setLoading(false)
          }
          })
          .catch(() => {
            if (cancelled) return
            if (hlsTimeoutRef.current) {
              clearTimeout(hlsTimeoutRef.current)
              hlsTimeoutRef.current = null
            }
            setError("Failed to load HLS library. Please check your connection.")
            setLoading(false)
          })
      }
    } else {
      video.src = url
      video.play().catch(() => {
        // Autoplay failed
      })
      setLoading(false)
    }

    return () => {
      cancelled = true
      if (hlsTimeoutRef.current) {
        clearTimeout(hlsTimeoutRef.current)
        hlsTimeoutRef.current = null
      }
      if (hlsRef.current) {
        hlsRef.current.destroy()
        hlsRef.current = null
      }
      video.removeAttribute("src")
      video.load()
    }
  }, [url, isYouTube, isDrive, isDailymotion, isRumble])

  useEffect(() => {
    const video = videoRef.current
    if (!video || isYouTube || isDrive || isDailymotion || isRumble) return

    const handleLoadedMetadata = () => {
      if (Number.isFinite(video.duration)) {
        setDuration(video.duration)
      }
      setLoading(false)
    }

    const handleTimeUpdate = () => {
      if (!isSeeking) {
        setCurrentTime(video.currentTime)
      }
    }

    const handleProgress = () => {
      if (video.buffered.length > 0 && Number.isFinite(video.duration) && video.duration > 0) {
        const bufferedEnd = video.buffered.end(video.buffered.length - 1)
        setBuffered(Math.min(100, Math.max(0, (bufferedEnd / video.duration) * 100)))
      }
    }

    const handlePlay = () => {
      setPlaying(true)
      setIsSeekingLoading(false)
    }
    const handlePause = () => setPlaying(false)
    const handleEnded = () => {
      setPlaying(false)
      onNextRef.current?.()
    }
    
    const handleWaiting = () => {
      setIsBuffering(true)
    }
    
    const handleCanPlay = () => {
      setIsBuffering(false)
      setIsSeekingLoading(false)
    }

    const handleError = () => {
      setError("Failed to load video")
      setLoading(false)
    }

    video.addEventListener("loadedmetadata", handleLoadedMetadata)
    video.addEventListener("timeupdate", handleTimeUpdate)
    video.addEventListener("progress", handleProgress)
    video.addEventListener("play", handlePlay)
    video.addEventListener("pause", handlePause)
    video.addEventListener("ended", handleEnded)
    video.addEventListener("waiting", handleWaiting)
    video.addEventListener("canplay", handleCanPlay)
    video.addEventListener("error", handleError)

    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata)
      video.removeEventListener("timeupdate", handleTimeUpdate)
      video.removeEventListener("progress", handleProgress)
      video.removeEventListener("play", handlePlay)
      video.removeEventListener("pause", handlePause)
      video.removeEventListener("ended", handleEnded)
      video.removeEventListener("waiting", handleWaiting)
      video.removeEventListener("canplay", handleCanPlay)
      video.removeEventListener("error", handleError)
    }
  }, [isYouTube, isDrive, isDailymotion, isRumble, isSeeking])

  const commitSeek = (requestedTime) => {
    const maxTime = Number.isFinite(duration) && duration > 0 ? duration : 0
    const newTime = Math.min(maxTime, Math.max(0, requestedTime))
    setIsSeekingLoading(true)

    if (isYouTube && playerRef.current) {
      playerRef.current.seekTo(newTime, true)
    } else if (videoRef.current) {
      videoRef.current.currentTime = newTime
    }

    setCurrentTime(newTime)
    pendingSeekRef.current = newTime
    setTimeout(() => setIsSeekingLoading(false), 800)
  }

  const skipForward = () => {
    commitSeek(currentTime + 10)
  }

  const skipBackward = () => {
    commitSeek(currentTime - 10)
  }

  const handleTouchStart = (e) => {
    const touch = e.touches[0]
    setSwipeStartY(touch.clientY)
    setSwipeStartX(touch.clientX)
    setIsSwiping(false)
    setSeekDelta(0)
    
    const containerWidth = containerRef.current?.clientWidth || 0
    const touchX = touch.clientX - containerRef.current?.getBoundingClientRect().left
    
    if (touchX > containerWidth * 0.85) {
      setSwipeType('volume')
    } else {
      setSwipeType('seek')
    }
  }

  const handleTouchMove = (e) => {
    if (!swipeType) return
    
    const touch = e.touches[0]
    const deltaY = swipeStartY - touch.clientY
    const deltaX = touch.clientX - swipeStartX
    
    if (swipeType === 'seek' && Math.abs(deltaX) > 10 && Math.abs(deltaY) < 50) {
      setIsSwiping(true)
      e.preventDefault()
      
      const sensitivity = duration > 3600 ? 0.3 : duration > 1800 ? 0.2 : 0.15
      const calculatedDelta = deltaX * sensitivity
      setSeekDelta(calculatedDelta)
      setShowSeekIndicator(true)
    } else if (Math.abs(deltaY) > 10 && Math.abs(deltaX) < 30) {
      setIsSwiping(true)
      e.preventDefault()
      
      if (swipeType === 'volume') {
        const newVolume = Math.min(100, Math.max(0, volume + deltaY))
        handleVolumeChange(newVolume)
        setShowVolumeIndicator(true)
        setSwipeStartY(touch.clientY)
      }
    }
  }

  const handleTouchEnd = () => {
    if (showVolumeIndicator) {
      setTimeout(() => setShowVolumeIndicator(false), 1000)
    }
    
    if (showSeekIndicator && seekDelta !== 0) {
      const newTime = Math.min(duration, Math.max(0, currentTime + seekDelta))
      commitSeek(newTime)
      
      setTimeout(() => {
        setShowSeekIndicator(false)
        setSeekDelta(0)
      }, 500)
    }
    
    setSwipeType(null)
    setIsSwiping(false)
  }

  const handleSingleTap = (e) => {
    if (isSwiping) return
    
    const now = Date.now()
    const timeSinceLastTap = now - lastTapRef.current.time

    if (timeSinceLastTap < 300) {
      lastTapRef.current = { time: 0, side: null }
      return
    }

    setTimeout(() => {
      if (lastTapRef.current.time !== 0) {
        setShowControls(!showControls)
        lastTapRef.current = { time: 0, side: null }
      }
    }, 300)
    
    lastTapRef.current = { time: now, side: null }
  }

  const resetControlsTimeout = () => {
    setShowControls(true)

    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current)
    }

    if (mouseMoveTimeoutRef.current) {
      clearTimeout(mouseMoveTimeoutRef.current)
    }

    if (playing) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false)
        setShowSettings(false)
        setShowVolumeSlider(false)
      }, 3000)
    }
  }

  useEffect(() => {
    if (playing) {
      resetControlsTimeout()
    } else {
      setShowControls(true)
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
    }

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current)
      }
      if (mouseMoveTimeoutRef.current) {
        clearTimeout(mouseMoveTimeoutRef.current)
      }
    }
  }, [playing])

  useEffect(() => {
    const handleFullscreenChange = () => {
      const isFullscreen = !!(
        document.fullscreenElement ||
        document.webkitFullscreenElement ||
        document.mozFullScreenElement ||
        document.msFullscreenElement
      )
      setFullscreen(isFullscreen)

      if (isFullscreen && screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("landscape").catch(() => {})
      }
    }

    document.addEventListener("fullscreenchange", handleFullscreenChange)
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange)
    document.addEventListener("mozfullscreenchange", handleFullscreenChange)
    document.addEventListener("MSFullscreenChange", handleFullscreenChange)

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange)
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange)
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange)
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange)
    }
  }, [])

  const handlePlayPause = () => {
    if (isYouTube && playerRef.current) {
      if (playing) {
        playerRef.current.pauseVideo()
      } else {
        playerRef.current.playVideo()
      }
    } else if (videoRef.current) {
      if (playing) {
        videoRef.current.pause()
      } else {
        videoRef.current.play().catch(() => {
          setPlaying(false)
          setShowControls(true)
        })
      }
    }
  }

  const handleSeekChange = (e) => {
    const newTime = Number.parseFloat(e.target.value)
    if (!Number.isFinite(newTime)) return

    setCurrentTime(newTime)
    pendingSeekRef.current = newTime

    if (!isSeeking) {
      commitSeek(newTime)
    }
  }

  const handleSeekMouseDown = (event) => {
    event?.stopPropagation()
    pendingSeekRef.current = currentTime
    setIsSeeking(true)
  }

  const handleSeekMouseUp = (event) => {
    event?.stopPropagation()
    commitSeek(pendingSeekRef.current)
    setIsSeeking(false)
  }

  const handleToggleMute = () => {
    if (isYouTube && playerRef.current) {
      if (volume > 0) {
        playerRef.current.setVolume(0)
        setVolume(0)
      } else {
        playerRef.current.setVolume(100)
        setVolume(100)
      }
    } else if (videoRef.current) {
      videoRef.current.muted = !videoRef.current.muted
      setVolume(videoRef.current.muted ? 0 : 100)
    }
  }

  const handleFullscreen = () => {
    if (!fullscreen) {
      if (containerRef.current?.requestFullscreen) {
        containerRef.current.requestFullscreen()
      } else if (containerRef.current?.webkitRequestFullscreen) {
        containerRef.current.webkitRequestFullscreen()
      } else if (containerRef.current?.mozRequestFullScreen) {
        containerRef.current.mozRequestFullScreen()
      } else if (containerRef.current?.msRequestFullscreen) {
        containerRef.current.msRequestFullscreen()
      }
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen()
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen()
      } else if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen()
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen()
      }
    }
  }

  const handlePrevious = () => {
    if (onPrevious) {
      onPrevious()
    }
  }

  const handleNext = () => {
    if (onNext) {
      onNext()
    }
  }

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return "0:00"
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = Math.floor(seconds % 60)
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
    }
    return `${m}:${s.toString().padStart(2, "0")}`
  }

  const playedPercentage =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0

  if (!url) {
    return (
      <div className="w-full aspect-video bg-gradient-to-br from-gray-900 to-black flex items-center justify-center text-white rounded-xl">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
          <p className="text-lg font-semibold">No video URL provided</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w-full aspect-video bg-gradient-to-br from-gray-900 to-black flex items-center justify-center text-white rounded-xl">
        <div className="text-center">
          <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
          <p className="text-lg font-semibold">{error}</p>
          <p className="text-sm text-gray-400 mt-2">Please check the video URL</p>
        </div>
      </div>
    )
  }

  if (isDrive) {
    const driveId = getDriveId(url)
    if (!driveId) {
      return (
        <div className="w-full aspect-video bg-gradient-to-br from-gray-900 to-black flex items-center justify-center text-white rounded-xl">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <p className="text-lg font-semibold">Invalid Google Drive URL</p>
          </div>
        </div>
      )
    }
    return (
      <div
        className="w-full aspect-video bg-black rounded-xl overflow-hidden"
        data-security-zone="video-player"
        onContextMenu={(event) => event.preventDefault()}
      >
        <iframe
          src={`https://drive.google.com/file/d/${driveId}/preview`}
          className="w-full h-full border-0"
          allow="autoplay; encrypted-media"
          allowFullScreen
        />
      </div>
    )
  }

  if (isDailymotion) {
    const dailymotionId = getDailymotionId(url)
    if (!dailymotionId) {
      return (
        <div className="w-full aspect-video bg-gradient-to-br from-gray-900 to-black flex items-center justify-center text-white rounded-xl">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <p className="text-lg font-semibold">Invalid Dailymotion URL</p>
          </div>
        </div>
      )
    }
    return (
      <div
        className="w-full aspect-video bg-black rounded-xl overflow-hidden"
        data-security-zone="video-player"
        onContextMenu={(event) => event.preventDefault()}
      >
        <iframe
          src={`https://geo.dailymotion.com/player.html?video=${dailymotionId}`}
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; picture-in-picture; web-share"
          allowFullScreen
        />
      </div>
    )
  }

  if (isRumble) {
    const rumbleId = getRumbleId(url)
    if (!rumbleId) {
      return (
        <div className="w-full aspect-video bg-gradient-to-br from-gray-900 to-black flex items-center justify-center text-white rounded-xl">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-500" />
            <p className="text-lg font-semibold">Invalid Rumble URL</p>
          </div>
        </div>
      )
    }
    return (
      <div
        className="w-full aspect-video bg-black rounded-xl overflow-hidden"
        data-security-zone="video-player"
        onContextMenu={(event) => event.preventDefault()}
      >
        <iframe
          src={`https://rumble.com/embed/${rumbleId}/`}
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
        />
      </div>
    )
  }

  return (
    <>
      <style jsx>{`
        /* Maximum YouTube branding blocking - Enhanced */
        #yt-player iframe {
          pointer-events: none !important;
        }
        #yt-player {
          pointer-events: auto;
        }
        
        /* Aggressive YouTube UI blocking - All variations */
        .ytp-watermark,
        .ytp-chrome-top-buttons,
        .ytp-show-cards-title,
        .ytp-pause-overlay,
        .ytp-scroll-min,
        .ytp-impression-link,
        .ytp-title,
        .ytp-title-text,
        .ytp-title-link,
        .ytp-gradient-top,
        .ytp-chrome-top,
        .ytp-show-cards-title,
        .ytp-ce-element,
        .ytp-cards-teaser,
        .ytp-endscreen-content,
        .ytp-suggested-action,
        .iv-branding,
        .annotation,
        .ytp-cued-thumbnail-overlay,
        .ytp-cued-thumbnail-overlay-image,
        .ytp-youtube-button,
        .ytp-cards-button,
        .ytp-info-panel-detail,
        .ytp-videowall-still,
        .ytp-ce-covering-overlay,
        .ytp-ce-element-show,
        .ytp-ce-covering-image,
        .ytp-ce-expanding-image,
        .ytp-ce-video,
        .ytp-ce-playlist,
        .ytp-ce-channel,
        .ytp-large-play-button,
        .ytp-button,
        a[class*="ytp"],
        div[class*="ytp-pause"],
        div[class*="ytp-cued"],
        .ytp-player-content,
        .ytp-title-channel,
        .ytp-title-expanded-overlay,
        .ytp-cards-button-icon,
        .ytp-watermark-icon,
        .ytp-share-button,
        .ytp-watch-later-button,
        .ytp-share-button-visible,
        .ytp-chrome-controls,
        .ytp-gradient-bottom,
        .ytp-progress-bar-container,
        .html5-video-player a,
        .html5-video-player .ytp-title,
        .html5-endscreen,
        .ytp-paid-content-overlay,
        .ytp-ce-shadow,
        .ytp-ce-size-1280,
        .ytp-ce-top-left-quad,
        .ytp-element-shadow,
        .ytp-ce-covering-overlay,
        .ytp-ce-expanding-overlay-background,
        .ytp-spinner,
        .ytp-error,
        .ytp-player-minimized,
        .ytp-contextmenu,
        .ytp-popup,
        .ytp-settings-menu,
        .ytp-panel,
        .ytp-menuitem,
        .ytp-iv-video-content,
        .ytp-cards-teaser-box,
        .ytp-flyout,
        .ytp-share-panel,
        .ytp-overflow-panel,
        .ytp-time-display,
        .ytp-volume-panel,
        .ytp-autonav-toggle-button,
        .ytp-fullerscreen-edu-button,
        .ytp-miniplayer-button,
        .ytp-size-button,
        .ytp-subtitles-button,
        .ytp-ad-overlay-container,
        .ytp-ad-text-overlay,
        .ytp-ad-player-overlay,
        .ytp-ad-overlay-close-button,
        .ytp-related-on-error-overlay,
        .ytp-upnext,
        .ytp-impression-link-content,
        .ytp-paid-content-overlay-text,
        .ytp-sb-unsubscribe,
        .ytp-sb-subscribe,
        .ytp-videowall-still-info-content,
        .ytp-cards-button-icon-default,
        .ytp-multicam-menu,
        .ytp-remote-button,
        .ytp-youtube-logo,
        .branding-img,
        .branding-img-container,
        [class*="branding"],
        [class*="watermark"],
        [class*="youtube"] {
          display: none !important;
          opacity: 0 !important;
          visibility: hidden !important;
          pointer-events: none !important;
          width: 0 !important;
          height: 0 !important;
          position: absolute !important;
          left: -9999px !important;
          z-index: -9999 !important;
          overflow: hidden !important;
        }
        
        /* Block all iframes from accepting pointer events */
        iframe[src*="youtube.com"],
        iframe[src*="youtube-nocookie.com"] {
          pointer-events: none !important;
        }
        
        /* Additional blocking for any remaining UI elements */
        .html5-video-player .ytp-chrome-bottom,
        .html5-video-player .ytp-chrome-top,
        .html5-video-player .ytp-gradient-top,
        .html5-video-player .ytp-gradient-bottom {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
        }
        
        /* Force hide on any state */
        .ytp-pause-overlay-container,
        .ytp-scroll-min,
        .ytp-player-content.ytp-iv-player-content {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
        }
        
        /* Enhanced blocking for pause/play/seek states */
        .html5-video-player:hover .ytp-gradient-top,
        .html5-video-player.ytp-autohide .ytp-gradient-top,
        .html5-video-player.ytp-autohide .ytp-chrome-top,
        .html5-video-player.paused-mode .ytp-gradient-top,
        .html5-video-player.playing-mode .ytp-gradient-top,
        .html5-video-player.seeking .ytp-gradient-top,
        .ytp-pause-overlay,
        .ytp-pause-overlay *,
        .ytp-info-panel-preview,
        div[class*="pause-overlay"],
        div[class*="info-panel"] {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          pointer-events: none !important;
          position: absolute !important;
          left: -10000px !important;
        }
        
        /* Block YouTube logo and title during all states */
        .ytp-chrome-top-buttons,
        .ytp-cards-teaser,
        .ytp-cards-teaser-label,
        .ytp-preview,
        .ytp-cued-thumbnail-overlay,
        .ytp-ce-element,
        .ytp-ce-covering-overlay,
        .ytp-ce-covering-image,
        .html5-video-player .ytp-title-beacon,
        .html5-video-player .ytp-title-channel-logo {
          display: none !important;
          visibility: hidden !important;
          opacity: 0 !important;
          width: 0 !important;
          height: 0 !important;
        }
        
        /* Improved seek bar */
        .seek-bar-container {
          position: relative;
          height: 24px;
          display: flex;
          align-items: center;
          cursor: pointer;
          padding: 8px 0;
          touch-action: none;
        }
        
        .seek-bar-track {
          position: absolute;
          width: 100%;
          height: 4px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 2px;
          overflow: visible;
          transition: height 0.2s ease;
        }
        
        .seek-bar-buffered {
          position: absolute;
          height: 100%;
          background: rgba(255, 255, 255, 0.3);
          border-radius: 2px;
          transition: width 0.3s ease;
        }
        
        .seek-bar-progress {
          position: absolute;
          height: 100%;
          background: linear-gradient(90deg, #ef4444, #dc2626);
          border-radius: 2px;
          transition: width 0.1s linear;
        }
        
        .seek-bar-thumb {
          position: absolute;
          top: 50%;
          width: 14px;
          height: 14px;
          background: white;
          border-radius: 50%;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
          transform: translateY(-50%) scale(0);
          margin-left: -7px;
          transition: transform 0.2s ease;
          pointer-events: none;
        }
        
        .seek-bar-container:hover .seek-bar-thumb,
        .seek-bar-container.seeking .seek-bar-thumb {
          transform: translateY(-50%) scale(1);
        }
        
        .seek-bar-container:hover .seek-bar-track {
          height: 6px;
        }
        
        .seek-bar-input {
          position: absolute;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
          z-index: 10;
        }
        
        /* Volume slider */
        .volume-slider-container {
          position: relative;
          height: 4px;
        }
        
        .volume-slider-thumb {
          position: absolute;
          top: 50%;
          width: 12px;
          height: 12px;
          background: white;
          border-radius: 50%;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
          transform: translateY(-50%);
          margin-left: -6px;
          pointer-events: none;
          transition: transform 0.2s ease;
        }
        
        .volume-slider-container:hover .volume-slider-thumb {
          transform: translateY(-50%) scale(1.2);
        }
        
        /* Smooth control transitions */
        .controls-container {
          transition: opacity 0.3s ease, transform 0.3s ease;
        }
        
        .controls-hidden {
          opacity: 0;
          pointer-events: none;
          transform: translateY(10px);
        }

        /* Remove all outlines and shadows on focus/active */
        * {
          -webkit-tap-highlight-color: transparent;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
          -moz-user-select: none;
          -ms-user-select: none;
          user-select: none;
        }

        button:focus,
        button:active,
        input:focus,
        input:active,
        div:focus,
        div:active {
          outline: none !important;
          box-shadow: none !important;
        }

        input[type="range"]:focus {
          outline: none !important;
        }
      `}</style>

      <div
        ref={containerRef}
        data-security-zone="video-player"
        className={`relative w-full aspect-video bg-black group rounded-xl overflow-hidden ${
          fullscreen ? "flex items-center justify-center" : ""
        }`}
        onMouseMove={resetControlsTimeout}
        onMouseLeave={() => playing && setShowControls(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        {isYouTube ? (
          <>
            <div
              key={url}
              ref={youtubeContainerRef}
              id="yt-player"
              className="absolute inset-0 w-full h-full transition-all duration-100"
            />
            {!hasStartedPlaying && <div className="absolute inset-0 bg-black z-10 pointer-events-none" />}
            <div className="absolute inset-0 pointer-events-none z-[10] bg-transparent" />
            <div className="absolute inset-0 pointer-events-none z-[15] bg-transparent" />
            <div className="absolute inset-0 pointer-events-none z-[20] bg-transparent" />
            <div className="absolute inset-0 pointer-events-none z-[25] bg-transparent" />
            <div className="absolute inset-0 pointer-events-none z-[28] bg-transparent" />
            <div className="absolute top-0 right-0 w-32 h-20 pointer-events-none z-[35] bg-transparent" />
            <div className="absolute top-0 left-0 right-0 h-16 pointer-events-none z-[35] bg-transparent" />
            <div className="absolute bottom-12 left-0 right-0 h-24 pointer-events-none z-[35] bg-transparent" />
            <div className="absolute inset-0 pointer-events-none z-[40] bg-transparent" />
            <div className="absolute inset-0 pointer-events-none z-[45] bg-transparent" />
          </>
        ) : isDrive ? (
          <iframe
            src={`https://drive.google.com/file/d/${getDriveId(url)}/preview`}
            className="absolute inset-0 w-full h-full border-0"
            allow="autoplay; encrypted-media; fullscreen"
            allowFullScreen
            onLoad={() => { setLoading(false); setPlaying(true); }}
          />
        ) : isDailymotion ? (
          <iframe
            src={`https://geo.dailymotion.com/player.html?video=${getDailymotionId(url)}`}
            className="absolute inset-0 w-full h-full border-0"
            allow="autoplay; fullscreen; picture-in-picture; web-share"
            allowFullScreen
            onLoad={() => { setLoading(false); setPlaying(true); }}
          />
        ) : isRumble ? (
          <iframe
            src={`https://rumble.com/embed/${getRumbleId(url)}/`}
            className="absolute inset-0 w-full h-full border-0"
            allow="autoplay; fullscreen; picture-in-picture"
            allowFullScreen
            onLoad={() => { setLoading(false); setPlaying(true); }}
          />
        ) : (
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-contain transition-all duration-100"
            playsInline
            preload="auto"
            autoPlay
            onContextMenu={(e) => e.preventDefault()}
          />
        )}

        {!isDrive && !isDailymotion && !isRumble && (
        <div className="absolute inset-0 flex z-30 pointer-events-none">
          <div 
            className="w-1/4 h-full pointer-events-auto cursor-pointer" 
            onClick={handleSingleTap}
            onDoubleClick={(e) => {
              e.preventDefault()
              skipBackward()
              setShowDoubleTapLeft(true)
              setDoubleTapCount(prev => ({ ...prev, left: prev.left + 1 }))
              setTimeout(() => {
                setShowDoubleTapLeft(false)
                setDoubleTapCount(prev => ({ ...prev, left: 0 }))
              }, 800)
            }}
          />
          <div 
            className="w-1/2 h-full pointer-events-auto cursor-pointer" 
            onClick={handleSingleTap}
          />
          <div 
            className="w-1/4 h-full pointer-events-auto cursor-pointer" 
            onClick={handleSingleTap}
            onDoubleClick={(e) => {
              e.preventDefault()
              skipForward()
              setShowDoubleTapRight(true)
              setDoubleTapCount(prev => ({ ...prev, right: prev.right + 1 }))
              setTimeout(() => {
                setShowDoubleTapRight(false)
                setDoubleTapCount(prev => ({ ...prev, right: 0 }))
              }, 800)
            }}
          />
        </div>
        )}

        {!isDrive && !isDailymotion && !isRumble && (
        <>
        {/* Volume Indicator - Right side of center */}
        <AnimatePresence>
          {showVolumeIndicator && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute top-1/2 left-1/2 -translate-y-1/2 translate-x-16 z-[55] pointer-events-none"
            >
              <div className="bg-black/90 backdrop-blur-xl rounded-2xl p-4 min-w-[80px]">
                <div className="flex flex-col items-center gap-3">
                  <Volume2 className="w-6 h-6 text-white" />
                  <div className="relative w-2 h-32 bg-white/20 rounded-full overflow-hidden">
                    <motion.div 
                      className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-red-500 to-red-400 rounded-full"
                      style={{ height: `${volume}%` }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    />
                  </div>
                  <span className="text-white font-bold text-sm">{Math.round(volume)}%</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Seek Indicator */}
        <AnimatePresence>
          {showSeekIndicator && (
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[55] pointer-events-none"
            >
              <div className="bg-black/90 backdrop-blur-xl rounded-2xl px-6 py-4 min-w-[120px]">
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-2">
                    {seekDelta > 0 ? (
                      <>
                        <RotateCw className="w-8 h-8 text-white" />
                        <span className="text-white font-bold text-2xl">+{Math.abs(Math.round(seekDelta))}s</span>
                      </>
                    ) : (
                      <>
                        <RotateCcw className="w-8 h-8 text-white" />
                        <span className="text-white font-bold text-2xl">-{Math.abs(Math.round(seekDelta))}s</span>
                      </>
                    )}
                  </div>
                  <span className="text-white/70 text-xs">{formatTime(currentTime + seekDelta)}</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Double Tap Left Indicator - YouTube Style */}
        <AnimatePresence>
          {showDoubleTapLeft && (
            <motion.div
              key="double-tap-left"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute top-1/2 left-[12%] -translate-y-1/2 z-[60] pointer-events-none"
            >
              <div className="bg-black/40 backdrop-blur-md rounded-full p-6 sm:p-8 flex items-center justify-center shadow-xl">
                <div className="flex flex-col items-center gap-1 sm:gap-2">
                  <div className="flex items-center gap-0.5 sm:gap-1">
                    <RotateCcw className="w-8 h-8 sm:w-10 sm:h-10 text-white" strokeWidth={2.5} />
                    <RotateCcw className="w-8 h-8 sm:w-10 sm:h-10 text-white -ml-5 sm:-ml-6 opacity-60" strokeWidth={2.5} />
                    <RotateCcw className="w-8 h-8 sm:w-10 sm:h-10 text-white -ml-5 sm:-ml-6 opacity-30" strokeWidth={2.5} />
                  </div>
                  <motion.span 
                    key={doubleTapCount.left}
                    initial={{ scale: 1.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-white font-bold text-lg sm:text-xl"
                  >
                    {10 * (doubleTapCount.left || 1)} seconds
                  </motion.span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Double Tap Right Indicator - YouTube Style */}
        <AnimatePresence>
          {showDoubleTapRight && (
            <motion.div
              key="double-tap-right"
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.5 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="absolute top-1/2 right-[12%] -translate-y-1/2 z-[60] pointer-events-none"
            >
              <div className="bg-black/40 backdrop-blur-md rounded-full p-6 sm:p-8 flex items-center justify-center shadow-xl">
                <div className="flex flex-col items-center gap-1 sm:gap-2">
                  <div className="flex items-center gap-0.5 sm:gap-1">
                    <RotateCw className="w-8 h-8 sm:w-10 sm:h-10 text-white opacity-30" strokeWidth={2.5} />
                    <RotateCw className="w-8 h-8 sm:w-10 sm:h-10 text-white -ml-5 sm:-ml-6 opacity-60" strokeWidth={2.5} />
                    <RotateCw className="w-8 h-8 sm:w-10 sm:h-10 text-white -ml-5 sm:-ml-6" strokeWidth={2.5} />
                  </div>
                  <motion.span 
                    key={doubleTapCount.right}
                    initial={{ scale: 1.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="text-white font-bold text-lg sm:text-xl"
                  >
                    {10 * (doubleTapCount.right || 1)} seconds
                  </motion.span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-40 bg-gradient-to-br from-gray-900 to-black">
            <div className="text-center">
              <Loader2 className="w-12 h-12 text-red-500 animate-spin mx-auto mb-4" />
              <p className="text-white text-lg font-semibold">Loading video...</p>
            </div>
          </div>
        )}

        {(isBuffering || isSeekingLoading) && !loading && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute inset-0 flex items-center justify-center z-40 pointer-events-none"
          >
            <div className="bg-black/60 backdrop-blur-sm rounded-2xl p-6">
              <Loader2 className="w-10 h-10 sm:w-12 sm:h-12 text-red-500 animate-spin" />
            </div>
          </motion.div>
        )}

        {!playing && !loading && (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center cursor-pointer z-35"
            onClick={handlePlayPause}
          >
            <motion.div
              whileHover={{ scale: 1.1 }}
              whileTap={{ scale: 0.95 }}
              className="w-16 h-16 bg-gradient-to-br from-red-500 to-red-600 rounded-full flex items-center justify-center backdrop-blur-sm"
            >
              <Play className="w-8 h-8 text-white fill-white ml-1" />
            </motion.div>
          </motion.div>
        )}

        <div
          className={`controls-container absolute bottom-0 left-0 right-0 z-[50] pb-2 ${
            !showControls ? "controls-hidden" : ""
          }`}
        >
          <div className="px-4 sm:px-6 pt-8 pb-3">
            <div
              className={`seek-bar-container ${isSeeking ? "seeking" : ""}`}
              onMouseDown={handleSeekMouseDown}
              onMouseUp={handleSeekMouseUp}
              onTouchStart={handleSeekMouseDown}
              onTouchMove={(event) => event.stopPropagation()}
              onTouchEnd={handleSeekMouseUp}
            >
              <div className="seek-bar-track">
                <div className="seek-bar-buffered" style={{ width: `${buffered}%` }} />
                <div className="seek-bar-progress" style={{ width: `${playedPercentage}%` }} />
              </div>
              <input
                type="range"
                min={0}
                max={duration || 0}
                step={0.1}
                value={currentTime}
                onChange={handleSeekChange}
                className="seek-bar-input"
              />
              <div className="seek-bar-thumb" style={{ left: `${playedPercentage}%` }} />
            </div>
          </div>

          <div className="flex items-center justify-between px-4 sm:px-6 py-2 gap-3">
            {/* Left controls */}
            <div className="flex items-center gap-3">
              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={handlePlayPause}
                className="text-white hover:text-red-500 transition-colors p-1"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? (
                  <Pause className="w-6 h-6 sm:w-7 sm:h-7" />
                ) : (
                  <Play className="w-6 h-6 sm:w-7 sm:h-7 fill-current" />
                )}
              </motion.button>

              <div className="flex items-center gap-1 md:gap-2 border-l border-white/20 pl-2 md:pl-3">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={skipBackward}
                  className="text-white hover:text-red-500 transition-colors p-0.5 md:p-1 relative"
                  aria-label="Skip backward 10 seconds"
                >
                  <RotateCcw className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 lg:w-6 lg:h-6" />
                  <span className="absolute text-[6px] sm:text-[7px] md:text-[8px] lg:text-[9px] font-bold top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white">10</span>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={skipForward}
                  className="text-white hover:text-red-500 transition-colors p-0.5 md:p-1 relative"
                  aria-label="Skip forward 10 seconds"
                >
                  <RotateCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 md:w-5 md:h-5 lg:w-6 lg:h-6" />
                  <span className="absolute text-[6px] sm:text-[7px] md:text-[8px] lg:text-[9px] font-bold top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white">10</span>
                </motion.button>
              </div>

              <div className="flex items-center gap-2 border-l border-white/20 pl-3 relative" ref={volumeSliderRef}>
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => {
                    if (window.innerWidth < 768) {
                      setShowVolumeSlider(!showVolumeSlider)
                    } else {
                      handleToggleMute()
                    }
                  }}
                  className="text-white hover:text-red-500 transition-colors p-1"
                  aria-label={volume === 0 ? "Unmute" : "Mute"}
                >
                  {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </motion.button>

                {/* Desktop volume slider */}
                <div className="hidden md:flex items-center gap-2">
                  <div className="relative w-20 volume-slider-container bg-white/20 rounded-full cursor-pointer">
                    <div
                      className="absolute h-full bg-white rounded-full transition-all"
                      style={{ width: `${volume}%` }}
                    />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={volume}
                      onChange={(e) => handleVolumeChange(Number(e.target.value))}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                      aria-label="Volume"
                    />
                    <div className="volume-slider-thumb" style={{ left: `${volume}%` }} />
                  </div>
                  <span className="text-white text-xs font-medium min-w-[3ch]">{Math.round(volume)}%</span>
                </div>

                {/* Mobile volume slider popup */}
                <AnimatePresence>
                  {showVolumeSlider && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.9 }}
                      className="md:hidden absolute bottom-full left-0 mb-3 bg-black/95 backdrop-blur-xl rounded-xl p-4 shadow-2xl border border-white/10"
                    >
                      <div className="flex items-center gap-3">
                        <VolumeX className="w-4 h-4 text-white/60" />
                        <div className="relative w-32 volume-slider-container bg-white/20 rounded-full cursor-pointer">
                          <div
                            className="absolute h-full bg-red-500 rounded-full transition-all"
                            style={{ width: `${volume}%` }}
                          />
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={volume}
                            onChange={(e) => handleVolumeChange(Number(e.target.value))}
                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                            aria-label="Volume"
                          />
                          <div className="volume-slider-thumb" style={{ left: `${volume}%` }} />
                        </div>
                        <Volume2 className="w-4 h-4 text-white" />
                      </div>
                      <div className="text-center text-white text-sm font-medium mt-2">{Math.round(volume)}%</div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className="text-white text-xs sm:text-sm font-medium border-l border-white/20 pl-3 whitespace-nowrap">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => setShowSettings(!showSettings)}
                  className="text-white hover:text-red-500 transition-colors p-1"
                  aria-label="Settings"
                >
                  <Settings className="w-5 h-5" />
                </motion.button>
                <AnimatePresence>
                  {showSettings && (
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.9 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.9 }}
                      className="absolute bottom-full right-0 mb-3 bg-black/95 backdrop-blur-xl rounded-xl p-3 min-w-[160px] shadow-2xl border border-white/10"
                    >
                      <div className="text-white text-xs font-bold mb-2 px-2 text-gray-400">SPEED</div>
                      <div className="space-y-1">
                        {playbackRates.map((rate) => (
                          <motion.button
                            key={rate}
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => {
                              setPlaybackRate(rate)
                              if (isYouTube && playerRef.current) {
                                playerRef.current.setPlaybackRate(rate)
                              } else if (videoRef.current) {
                                videoRef.current.playbackRate = rate
                              }
                              setShowSettings(false)
                            }}
                            className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-all ${
                              playbackRate === rate
                                ? "bg-gradient-to-r from-red-500 to-red-600 text-white font-semibold"
                                : "text-white/80 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            {rate === 1 ? "Normal" : `${rate}x`}
                          </motion.button>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <motion.button
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={handleFullscreen}
                className="text-white hover:text-red-500 transition-colors p-1"
                aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              >
                {fullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
              </motion.button>
            </div>
          </div>
        </div>
        </>
        )}
      </div>
    </>
  )
}
