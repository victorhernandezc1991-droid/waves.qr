export function filtrarPorTurno(pedidos, turno) {
  if (turno === "completo") return pedidos;
  return pedidos.filter(p => {
    const hora = p.hora || "";
    const [h] = hora.split(":").map(Number);
    if (isNaN(h)) return false;
    if (turno === "mañana") return h >= 6  && h < 12;
    if (turno === "tarde")  return h >= 12 && h < 18;
    if (turno === "noche")  return h >= 18 && h < 24;
    return true;
  });
}
