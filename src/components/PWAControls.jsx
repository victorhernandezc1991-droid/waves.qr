import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";

/**
 * Banner que aparece cuando hay una nueva versión disponible.
 * El usuario hace click y se actualiza el SW + recarga.
 */
export function UpdateBanner() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) { console.error("[PWA]", err); },
  });

  if (!needRefresh) return null;
  return (
    <div className="pwa-update-banner">
      <span>🚀 Hay una versión nueva de la app.</span>
      <button onClick={() => updateServiceWorker(true)}>Actualizar</button>
      <button className="pwa-update-dismiss" onClick={() => setNeedRefresh(false)} aria-label="Cerrar">✕</button>
    </div>
  );
}

/**
 * Botón "Instalar app" que solo aparece si el navegador dispara
 * `beforeinstallprompt` (Chrome/Edge en Android y desktop).
 * iOS Safari no lo dispara — ahí el usuario instala manualmente desde Compartir.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState(null);
  const [hidden, setHidden]     = useState(() => sessionStorage.getItem("pwaInstallHidden") === "1");

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferred || hidden) return null;

  const onInstall = async () => {
    deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setDeferred(null);
  };
  const onDismiss = () => {
    setHidden(true);
    sessionStorage.setItem("pwaInstallHidden", "1");
  };

  return (
    <div className="pwa-install-prompt">
      <span>📲 Instalá Waves en tu teléfono.</span>
      <button onClick={onInstall}>Instalar</button>
      <button className="pwa-install-dismiss" onClick={onDismiss} aria-label="Cerrar">✕</button>
    </div>
  );
}
