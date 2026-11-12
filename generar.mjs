import fs from "fs";

const TIENDAS = {
  "eyelit.xml": { dominio: "eyelit.com.ar", moneda: "ARS" },
  "scalpers.xml": { dominio: "cl-scalperscompany-com.myshopify.com", moneda: "CLP" },
  "amphora.xml": { dominio: "amphora-cl.myshopify.com", moneda: "CLP" },
  "renatta.xml": { dominio: "renattandgo.cl", moneda: "CLP" },
};

const esc = (t) => String(t ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const limpiar = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function traerPagina(url) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(url);
      if (res.ok) return (await res.json()).products || [];
      console.log(`  Intento ${intento} fallo (codigo ${res.status})`);
    } catch (e) {
      console.log(`  Intento ${intento} fallo (${e.message})`);
    }
    await pausa(5000 * intento);
  }
  throw new Error(`No se pudo leer ${url}`);
}

for (const [archivo, { dominio, moneda }] of Object.entries(TIENDAS)) {
  try {
    console.log(`Leyendo ${dominio}...`);
    const productos = {};
    for (let page = 1; page <= 40; page++) {
      const lote = await traerPagina(`https://${dominio}/products.json?limit=250&page=${page}`);
      if (lote.length === 0) break;
      for (const p of lote) productos[p.id] = p;
      await pausa(1000);
    }

    const lista = Object.values(productos);
    if (lista.length === 0) throw new Error("La tienda no devolvio productos");

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Feed de productos ${esc(dominio)}</title>
    <link>https://${esc(dominio)}</link>
    <description>Catalogo completo de productos</description>\n`;

    for (const p of lista) {
      const variantes = p.variants || [];
      const disponibles = variantes.filter((v) => v.available);
      const base = disponibles[0] || variantes[0] || {};
      const precio = Number(base.price || 0);
      const anterior = Number(base.compare_at_price || 0);
      const nombres = disponibles.map((v) => v.title).filter((t) => t && t !== "Default Title");

      let descripcion = limpiar(p.body_html).slice(0, 1000);
      if (nombres.length) descripcion += ` Variantes disponibles: ${nombres.join(", ")}.`;

      xml += `    <item>
      <g:id>${esc(p.id)}</g:id>
      <g:title>${esc(p.title)}</g:title>
      <g:description>${esc(descripcion)}</g:description>
      <g:link>https://${esc(dominio)}/products/${esc(p.handle)}</g:link>
      <g:image_link>${esc(p.images?.[0]?.src || "")}</g:image_link>
      <g:availability>${disponibles.length ? "in_stock" : "out_of_stock"}</g:availability>
      <g:price>${(anterior > precio ? anterior : precio).toFixed(2)} ${moneda}</g:price>\n`;
      if (anterior > precio) xml += `      <g:sale_price>${precio.toFixed(2)} ${moneda}</g:sale_price>\n`;
      xml += `      <g:brand>${esc(p.vendor)}</g:brand>
      <g:product_type>${esc(p.product_type)}</g:product_type>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
    </item>\n`;
    }
    xml += `  </channel>\n</rss>\n`;

    fs.writeFileSync(archivo, xml);
    const mb = (Buffer.byteLength(xml) / 1048576).toFixed(1);
    console.log(`${archivo}: ${lista.length} productos guardados (${mb} MB)`);
  } catch (e) {
    console.log(`${archivo}: NO se actualizo (${e.message}). Se mantiene el archivo anterior.`);
    fs.appendFileSync("/tmp/fallos-feeds.txt", `${archivo}: ${e.message}\n`);
  }
}
