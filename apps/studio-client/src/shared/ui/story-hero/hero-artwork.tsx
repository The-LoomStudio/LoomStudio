import type { ReactEventHandler } from 'react'
import styles from './hero-artwork.module.scss'

/** Display the source at its original ratio; the mask only blends its edge. */
export function HeroArtwork(props: { src: string; onError?: ReactEventHandler<HTMLImageElement> }) {
  return <span className={styles.artwork}>
    <img className={styles.image} src={props.src} alt="" onError={props.onError} />
  </span>
}
