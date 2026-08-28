import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'

// Camera barcode scanner for the Nutrition tab — reads EAN-13/UPC-A product codes so a
// scanned item can be matched against a food already saved with that barcode (see
// foodByBarcode in lib/nutrition.js). There's no product database behind this MVP: a code
// that matches nothing prompts "create this food, save the barcode" so the next scan of the
// same product resolves instantly — the door stays open to swap in a real product-lookup API
// (Edamam/FatSecret) later without changing anything downstream of onDetect.
//
// @zxing/browser is dynamically imported so its decoder (and the WASM/JS pattern tables it
// pulls in) never reach the main bundle for a profile that never opens the scanner — same
// lazy-loading approach the app already uses for locale packs and exercise instructions.
export default function BarcodeScanner({ onDetect, close }) {
  const videoRef = useRef(null)
  const controlsRef = useRef(null)
  const doneRef = useRef(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        if (cancelled) return
        const reader = new BrowserMultiFormatReader()
        const controls = await reader.decodeFromConstraints(
          { video: { facingMode: 'environment' } },
          videoRef.current,
          (result) => {
            if (result && !doneRef.current) {
              doneRef.current = true
              onDetect(result.getText())
            }
          }
        )
        if (cancelled) { controls.stop(); return }
        controlsRef.current = controls
      } catch (e) {
        if (!cancelled) setError(e && e.name === 'NotAllowedError' ? t('Camera access was denied') : t('Could not start the camera'))
      }
    })()
    return () => { cancelled = true; controlsRef.current?.stop(); controlsRef.current = null }
  }, [onDetect])

  return <>
    <h3>{t('Scan barcode')}</h3>
    {error
      ? <div className="muted small" style={{ padding: '30px 4px' }}>{error}</div>
      : <>
        <div className="scan-wrap"><video ref={videoRef} muted playsInline /><div className="scan-frame" /></div>
        <div className="muted small" style={{ textAlign: 'center', marginTop: 10 }}>{t('Point the camera at a barcode')}</div>
      </>}
    <div style={{ height: 12 }} />
    <Button onClick={close}>{t('Cancel')}</Button>
  </>
}
