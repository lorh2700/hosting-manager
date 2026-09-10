'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowDown, ArrowUpRight, Pause, Play } from 'lucide-react';
import styles from './StayHero.module.css';

type NetworkNavigator = Navigator & { connection?: EventTarget & { saveData?: boolean } };
function subscribeToPlaybackPreference(onChange: () => void) {
  const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
  const connection = (navigator as NetworkNavigator).connection;
  preference.addEventListener('change', onChange);
  connection?.addEventListener('change', onChange);
  return () => {
    preference.removeEventListener('change', onChange);
    connection?.removeEventListener('change', onChange);
  };
}
function allowsAutomaticPlayback() {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    && !(navigator as NetworkNavigator).connection?.saveData;
}
function serverPlaybackPreference() { return false; }

export function ScrollUnfoldHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const automaticPlayback = useSyncExternalStore(subscribeToPlaybackPreference, allowsAutomaticPlayback, serverPlaybackPreference);
  const [manualPlayback, setManualPlayback] = useState(false);
  const enabled = automaticPlayback || manualPlayback;
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled || failed) return;
    let visible = true;
    const syncPlayback = () => {
      if (paused || !visible || document.hidden) video.pause();
      else void video.play().catch(() => setPlaying(false));
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      syncPlayback();
    }, { threshold: 0.05 });
    observer.observe(video);
    document.addEventListener('visibilitychange', syncPlayback);
    syncPlayback();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', syncPlayback);
      video.pause();
    };
  }, [enabled, paused, failed]);

  function togglePlayback() {
    if (playing) { setPaused(true); videoRef.current?.pause(); }
    else {
      setManualPlayback(true);
      setPaused(false);
      if (enabled) void videoRef.current?.play().catch(() => setPlaying(false));
    }
  }

  return (
    <section className={styles.hero} aria-labelledby="stay-hero-title">
      <div className={styles.scene}>
        <div className={styles.media}>
          <Image src="/videos/hanok-hero-poster.webp" alt="북촌의 기와지붕 사이로 이어지는 골목" fill priority sizes="100vw" className={styles.photo} />
          {enabled && !failed && (
            <video ref={videoRef} className={styles.video} src="/videos/hanok-hero-v1.mp4"
              muted loop playsInline preload="metadata" poster="/videos/hanok-hero-poster.webp"
              aria-hidden="true" tabIndex={-1}
              onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
              onError={() => { setFailed(true); setPlaying(false); }} />
          )}
          <div className={styles.shade} aria-hidden="true" />
          {!failed && <button type="button" onClick={togglePlayback} className={styles.playback}
            aria-label={playing ? '배경 영상 일시정지' : '배경 영상 재생'}>
            {playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            <span>{playing ? '일시정지' : '영상 재생'}</span>
          </button>}
          <span className={styles.filmLabel}>BUKCHON · HANOK STAYS</span>
        </div>
        <div className={styles.content}>
          <p className={styles.eyebrow}>SEOUL, BUKCHON / VOID ANCHAE</p>
          <h1 id="stay-hero-title" className={styles.title}>골목을 걷다,<br /><span>한옥에 머물다.</span></h1>
          <p className={styles.description}>문을 열면 시작되는 느긋한 하루.<br />당신의 여행에 어울리는 한옥을 만나보세요.</p>
          <div className={styles.actions}>
            <Link href="#find-stay" className={styles.primary}>나의 한옥 예약하기 <ArrowUpRight size={18} aria-hidden="true" /></Link>
            <Link href="#spaces" className={styles.secondary}>공간 둘러보기 <ArrowDown size={17} aria-hidden="true" /></Link>
          </div>
        </div>
      </div>
    </section>
  );
}
