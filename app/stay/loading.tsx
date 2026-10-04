import { Logo } from '@/components/Logo';
import styles from './GuestStay.module.css';

export default function StayLoading() {
  return <main className={styles.loading} aria-busy="true"><Logo variant="black" width={170} /><div className={styles.loadingDot} /><p role="status">게스트 라운지를 준비하고 있습니다.<br />Preparing your stay.</p></main>;
}
