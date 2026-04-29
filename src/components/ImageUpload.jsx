import { useState, useRef } from "react";

const CLOUDINARY_CLOUD_NAME    = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_UPLOAD_PRESET = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_UPLOAD_PRESET) {
  console.error(
    "[ImageUpload] Faltan variables de entorno VITE_CLOUDINARY_CLOUD_NAME o " +
    "VITE_CLOUDINARY_UPLOAD_PRESET. La subida de imágenes no va a funcionar."
  );
}

export async function compressImage(file, maxSize = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const ratio  = Math.min(maxSize / img.width, maxSize / img.height, 1);
        const canvas = document.createElement("canvas");
        canvas.width  = img.width  * ratio;
        canvas.height = img.height * ratio;
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("Compression failed")), "image/webp", 0.85);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function uploadToCloudinary(blob, folder, onProgress) {
  const formData = new FormData();
  formData.append("file", blob, `producto-${Date.now()}.webp`);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  formData.append("folder", folder || "productos");
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(Math.round(e.loaded / e.total * 100));
    };
    xhr.onload = () => {
      if (xhr.status === 200) resolve(JSON.parse(xhr.responseText).secure_url);
      else reject(new Error(`Cloudinary error ${xhr.status}: ${xhr.responseText}`));
    };
    xhr.onerror = () => reject(new Error("Error de red al subir la imagen."));
    xhr.send(formData);
  });
}

export default function ImageUpload({ onUpload, addToast, initialUrl = "", storagePath = "productos" }) {
  const [preview,   setPreview]   = useState(initialUrl || null);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [success,   setSuccess]   = useState(false);
  const [filename,  setFilename]  = useState("");
  const fileRef = useRef(null);

  const reset = () => {
    setPreview(null); setProgress(0); setSuccess(false); setFilename("");
    onUpload(""); if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg","image/png","image/webp"].includes(file.type)) return addToast("❌ Formato no soportado. Usá JPG, PNG o WebP.", "error");
    if (file.size > 6 * 1024 * 1024) return addToast("❌ Imagen demasiado pesada. Máximo 6 MB.", "error");
    setFilename(file.name);
    setUploading(true);
    setProgress(0);
    setSuccess(false);
    try {
      const compressed = await compressImage(file, 800);
      const localUrl   = URL.createObjectURL(compressed);
      setPreview(localUrl);
      const url = await uploadToCloudinary(compressed, storagePath, setProgress);
      onUpload(url);
      setSuccess(true);
      addToast("✅ Imagen subida.", "success");
    } catch (err) {
      console.error(err);
      addToast("❌ Error al subir.", "error");
      reset();
    } finally { setUploading(false); }
  };

  return (
    <div className="img-uploader">
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFile} style={{ display: "none" }} />
      {!preview ? (
        <div className="img-uploader-dropzone" onClick={() => fileRef.current?.click()}>
          <span className="img-uploader-dropzone-icon">📷</span>
          <span className="img-uploader-dropzone-label">Subir imagen del producto</span>
          <small className="img-uploader-dropzone-hint">JPG, PNG, WebP · máx 6 MB · se comprime a 800×800px</small>
          <small className="img-uploader-dropzone-hint" style={{ color: "var(--accent-yellow)" }}>☁️ Vía Cloudinary (gratis)</small>
        </div>
      ) : (
        <div className="img-uploader-preview-area">
          <div className={`img-uploader-preview-wrap ${success ? "upload-success" : ""}`}>
            <img src={preview} alt="Preview" className="img-uploader-preview" />
            {uploading && (
              <div className="img-uploader-overlay">
                <div className="img-uploader-spinner" />
                <span className="img-uploader-pct">{progress}%</span>
              </div>
            )}
            {success && !uploading && <div className="img-uploader-success-overlay"><div className="img-uploader-check">✓</div></div>}
          </div>
          {filename && <p className="img-uploader-filename">{filename}</p>}
          <div className="img-uploader-preview-actions">
            <button type="button" className="img-uploader-btn-remove img-uploader-btn-change" onClick={() => fileRef.current?.click()} disabled={uploading}>Cambiar</button>
            <button type="button" className="img-uploader-btn-remove" onClick={reset} disabled={uploading}>Quitar</button>
          </div>
        </div>
      )}
    </div>
  );
}
