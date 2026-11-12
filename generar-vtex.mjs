import fs from "fs";

const TIENDAS_VTEX = {
  "adidas.xml": {
    api: "adidasuy.vtexcommercestable.com.br",
    dominio: "www.adidas.com.uy",
    coleccion: "149",
    moneda: "UYU",
  },
};

const esc = (t) => String(t ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const limpiar = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function traerPagina(url) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
      if (res.ok) return await res.json();
      console.log(`  Intento ${intento} fallo (codigo ${res.status})`);
    } catch (e) {
      console.log(`  Intento ${intento} fallo (${e.message})`);
    }
    await pausa(5000 * intento);
  }
  throw new Error(`No se pudo leer ${url}`);
}

const oferta = (item) => item?.sellers?.[0]?.commertialOffer || {};

for (const [archivo, { api, dominio, coleccion, moneda }] of Object.entries(TIENDAS_VTEX)) {
  try {
    console.log(`Leyendo ${api} (coleccion ${coleccion})...`);
    const productos = {};
    for (let desde = 0; desde < 2500; desde += 50) {
      const url = `https://${api}/api/catalog_system/pub/products/search?_from=${desde}&_to=${desde + 49}&fq=productClusterIds:${coleccion}&O=OrderByNameASC`;
      const lote = await traerPagina(url);
      if (!Array.isArray(lote) || lote.length === 0) break;
      for (const p of lote) productos[p.productId] = p;
      if (lote.length < 50) break;
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
      const items = p.items || [];
      const disponibles = items.filter((it) => (oferta(it).AvailableQuantity || 0) > 0);
      const base = disponibles[0] || items[0] || {};
      const precio = Number(oferta(base).Price || 0);
      const anterior = Number(oferta(base).ListPrice || 0);
      const nombres = disponibles.map((it) => it.name).filter(Boolean);
      const imagen = base.images?.[0]?.imageUrl || items[0]?.images?.[0]?.imageUrl || "";
      const categoria = (p.categories?.[0] || "").replace(/^\/|\/$/g, "").replace(/\//g, " > ");

      let descripcion = limpiar(p.description).slice(0, 1000);
      if (nombres.length) descripcion += ` Variantes disponibles: ${nombres.join(", ")}.`;

      xml += `    <item>
      <g:id>${esc(p.productId)}</g:id>
      <g:title>${esc(p.productName)}</g:title>
      <g:description>${esc(descripcion)}</g:description>
      <g:link>https://${esc(dominio)}/${esc(p.linkText)}/p</g:link>
      <g:image_link>${esc(imagen)}</g:image_link>
      <g:availability>${disponibles.length ? "in_stock" : "out_of_stock"}</g:availability>
      <g:price>${(anterior > precio ? anterior : precio).toFixed(2)} ${moneda}</g:price>\n`;
      if (anterior > precio) xml += `      <g:sale_price>${precio.toFixed(2)} ${moneda}</g:sale_price>\n`;
      xml += `      <g:brand>${esc(p.brand)}</g:brand>
      <g:product_type>${esc(categoria)}</g:product_type>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
    </item>\n`;
    }
    xml += `  </channel>\n</rss>\n`;

    fs.writeFileSync(archivo, xml);
    console.log(`${archivo}: ${lista.length} productos guardados`);
  } catch (e) {
    console.log(`${archivo}: NO se actualizo (${e.message}). Se mantiene el archivo anterior.`);
    fs.appendFileSync("/tmp/fallos-feeds.txt", `${archivo}: ${e.message}\n`);
  }
}
