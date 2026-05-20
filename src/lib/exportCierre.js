// ─── Helpers de exportación de Cierre de Caja ─────────────────────────────────
import { etiquetaPedido } from "./pedidos";

function escapeCSV(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (/[",\n;]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
}

/**
 * Genera CSV del cierre con desglose por método y comandas detalladas.
 * Compatible con Excel argentino (separador `;`, BOM UTF-8 para tildes).
 */
export function exportCierreCSV({ fecha, turno, totalVentas, desglose, tickets, promedio, anulaciones, montoAnulaciones, finalizados, nombreComercio = "Waves" }) {
  const SEP   = ";";
  const lines = [];

  // Encabezado
  lines.push(`Cierre de Caja — ${nombreComercio}`);
  lines.push(`Fecha${SEP}${fecha}`);
  lines.push(`Turno${SEP}${turno}`);
  lines.push(`Generado${SEP}${new Date().toLocaleString("es-AR")}`);
  lines.push("");

  // Resumen
  lines.push("RESUMEN");
  lines.push(`Total Ventas${SEP}${totalVentas}`);
  lines.push(`Tickets Emitidos${SEP}${tickets}`);
  lines.push(`Ticket Promedio${SEP}${Math.round(promedio)}`);
  lines.push(`Anulaciones${SEP}${anulaciones}`);
  lines.push(`Monto Anulado${SEP}${montoAnulaciones}`);
  lines.push("");

  // Desglose
  lines.push("DESGLOSE POR MÉTODO DE PAGO");
  lines.push(`Efectivo${SEP}${desglose.efectivo || 0}`);
  lines.push(`Tarjeta${SEP}${desglose.tarjeta || 0}`);
  lines.push(`Mercado Pago${SEP}${desglose.mercadoPago || 0}`);
  if (desglose.sinEspecificar > 0) lines.push(`Sin especificar${SEP}${desglose.sinEspecificar}`);
  lines.push("");

  // Detalle de comandas
  lines.push("DETALLE DE COMANDAS");
  lines.push(["Orden", "Tipo / Cliente", "Hora", "Método", "Items", "Total"].map(escapeCSV).join(SEP));
  finalizados.forEach(p => {
    const itemsStr = (p.items || []).map(it => `${it.cantidad}x ${it.nombre}`).join(" | ");
    lines.push([
      p.numeroOrden || "",
      etiquetaPedido(p),
      p.hora || "",
      p.metodoPago || "",
      itemsStr,
      p.total || 0,
    ].map(escapeCSV).join(SEP));
  });

  // BOM UTF-8 para que Excel respete tildes
  const csv = "﻿" + lines.join("\r\n");
  const filename = `cierre-${fecha.replace(/\//g, "-")}-${turno}.csv`;
  downloadFile(csv, filename, "text/csv;charset=utf-8");
}

/**
 * Imprime el cierre usando la API nativa del navegador.
 * El usuario elige "Guardar como PDF" en el diálogo de impresión.
 * El stylesheet @media print (en App.css) controla la apariencia.
 */
export function printCierre() {
  document.body.classList.add("printing-cierre");
  // Pequeño delay para que el DOM aplique la clase antes de imprimir
  setTimeout(() => {
    window.print();
    setTimeout(() => document.body.classList.remove("printing-cierre"), 500);
  }, 50);
}
