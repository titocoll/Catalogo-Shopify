import fs from "fs";

const FEEDS_WOO = {
  "uniwork.xml": {
    origen: "https://uniwork.com.uy/wp-content/uploads/woo-product-feed-pro/xml/ve6GxS5D2iOq6pw6WymIkkYwXaMEVBHw.xml",
    dominio: "uniwork.com.uy",
    moneda: "UYU",
  },
};

const esc = (t) => String(t ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&apos;");

const decodificarUnaVez = (t) => String(t || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/&apos;|&#039;|&#39;/g, "'").replace(/&amp;/g, "&");
const decodificar = (t) => decodificarUnaVez(decodificarUnaVez(t)).trim();

const limpiar = (html) => String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

const campo = (bloque, nombre) => {
  const m = bloque.match(new RegExp(`<(?:g:)?${nombre}>([\\s\\S]*?)</(?:g:)?${nombre}>`));
  return m ? decodificar(m[1]) : "";
};
const numero = (t) => {
  const m = String(t || "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};
const enStock = (t) => /in.?stock/i.test(t) && !/out/i.test(t);

async function traerFeed(url) {
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (res.ok) return await res.text();
      console.log(`  Intento ${intento} fallo (codigo ${res.status})`);
    } catch (e) {
      console.log(`  Intento ${intento} fallo (${e.message})`);
    }
    await pausa(5000 * intento);
  }
  throw new Error(`No se pudo leer ${url}`);
}

for (const [archivo, { origen, dominio, moneda }] of Object.entries(FEEDS_WOO)) {
  try {
    console.log(`Leyendo feed de ${dominio}...`);
    const original = await traerFeed(origen);
    const bloques = original.match(/<item[\s>][\s\S]*?<\/item>/g) || [];
    console.log(`  ${bloques.length} items en el feed original`);

    const grupos = {};
    for (const b of bloques) {
      const v = {
        id: campo(b, "id"),
        grupo: campo(b, "item_group_id"),
        titulo: campo(b, "title"),
        descripcion: limpiar(campo(b, "description")),
        link: campo(b, "link").split("?")[0],
        linkCompleto: campo(b, "link"),
        imagen: campo(b, "image_link"),
        disponible: enStock(campo(b, "availability")),
        precio: numero(campo(b, "price")),
        oferta: numero(campo(b, "sale_price")),
        marca: campo(b, "brand"),
        tipo: campo(b, "product_type"),
        talle: campo(b, "size"),
        color: campo(b, "color"),
      };
      const clave = v.grupo || v.id;
      if (!clave) continue;
      (grupos[clave] ||= []).push(v);
    }

    const lista = Object.entries(grupos);
    if (lista.length === 0) throw new Error("El feed no tiene productos");

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">
  <channel>
    <title>Feed de productos ${esc(dominio)}</title>
    <link>https://${esc(dominio)}</link>
    <description>Catalogo completo de productos</description>\n`;

    for (const [clave, variantes] of lista) {
      const disponibles = variantes.filter((v) => v.disponible);
      const base = disponibles[0] || variantes[0];
      const titulo = variantes.map((v) => v.titulo).filter(Boolean).sort((a, b) => a.length - b.length)[0] || "";
      const descripcionBase = (variantes.find((v) => v.descripcion) || {}).descripcion || "";

      const talles = new Set(), colores = new Set(), otras = new Set();
      for (const v of disponibles) {
        if (v.talle) talles.add(v.talle);
        if (v.color) colores.add(v.color);
        if (!v.talle && !v.color) {
          try {
            for (const [k, val] of new URL(v.linkCompleto).searchParams) {
              if (k.startsWith("attribute_") && val) otras.add(decodeURIComponent(val).replace(/-/g, " "));
            }
          } catch {}
        }
      }

      let descripcion = descripcionBase.slice(0, 1000);
      if (talles.size) descripcion += ` Talles disponibles: ${[...talles].join(", ")}.`;
      if (colores.size) descripcion += ` Colores disponibles: ${[...colores].join(", ")}.`;
      if (otras.size) descripcion += ` Opciones disponibles: ${[...otras].join(", ")}.`;

      const precio = base.precio;
      const oferta = base.oferta && base.oferta < precio ? base.oferta : 0;

      xml += `    <item>
      <g:id>${esc(clave)}</g:id>
      <g:title>${esc(titulo)}</g:title>
      <g:description>${esc(descripcion.trim())}</g:description>
      <g:link>${esc(base.link)}</g:link>
      <g:image_link>${esc(base.imagen)}</g:image_link>
      <g:availability>${disponibles.length ? "in_stock" : "out_of_stock"}</g:availability>
      <g:price>${precio.toFixed(2)} ${moneda}</g:price>\n`;
      if (oferta) xml += `      <g:sale_price>${oferta.toFixed(2)} ${moneda}</g:sale_price>\n`;
      xml += `      <g:brand>${esc(base.marca)}</g:brand>
      <g:product_type>${esc(base.tipo)}</g:product_type>
      <g:condition>new</g:condition>
      <g:identifier_exists>no</g:identifier_exists>
    </item>\n`;
    }
    xml += `  </channel>\n</rss>\n`;

    fs.writeFileSync(archivo, xml);
    console.log(`${archivo}: ${lista.length} productos guardados`);
  } catch (e) {
    console.log(`${archivo}: NO se actualizo (${e.message}). Se mantiene el archivo anterior.`);
  }
}
