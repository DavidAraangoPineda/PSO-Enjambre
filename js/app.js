/*
 * Parte visual: dibuja el enjambre de pso.js sobre el mapa de la función.
 *
 * - PSO avanza por saltos (una iteración a la vez); aquí cada salto se anima
 *   con una transición suave para que el movimiento se vea fluido.
 * - Una cámara puede seguir al enjambre: el mapa se recalcula para la zona
 *   visible, así que al hacer zoom sigue viéndose nítido.
 * - El modo "Explicación narrada" es una secuencia automática con subtítulos.
 */
(function () {
  'use strict';

  const { Enjambre, FUNCIONES, ESCENARIOS } = window.PSO;
  const $ = (id) => document.getElementById(id);

  const lienzo = $('lienzo');
  const ctx = lienzo.getContext('2d');
  const grafica = $('grafica');
  const gctx = grafica.getContext('2d');
  const mapa = document.createElement('canvas');
  const mctx = mapa.getContext('2d');
  const niebla = document.createElement('canvas');
  const nctx = niebla.getContext('2d');

  const LARGO_ESTELA = 26;
  const INTENTOS_RETO = 10;
  const RES_MOVIMIENTO = 300; // resolución del mapa mientras la cámara se mueve
  const RES_QUIETO = 720; // resolución cuando la cámara se detiene
  const MITAD_MINIMA = 0.05; // zoom máximo: la vista más pequeña mide 0.1 de lado
  const CANCELADO = Symbol('cancelado');
  const COLOR = {
    salmon: '#f28b7f',
    teal: '#4fb3a0',
    azul: '#7cc4ff',
    verde: '#7ee0b5',
    dorado: '#ffd27a',
    nucleo: '#fff4f1',
  };

  // Paleta del mapa: zonas bajas (buenas) oscuras, zonas altas claras.
  const PALETA = [
    [0.0, '#010608'],
    [0.22, '#04211f'],
    [0.45, '#0a3f39'],
    [0.68, '#16615a'],
    [0.86, '#337c6f'],
    [1.0, '#65a092'],
  ].map(([t, hex]) => [t, hexARgb(hex)]);

  const brillo = crearBrillo();

  const estado = {
    funcion: 'rastrigin',
    n: 30,
    w: 0.7,
    c1: 1.5,
    c2: 1.5,
    decaimiento: false,
    semilla: 7,
    maxIter: 100,
    iterPorSegundo: 6,
    escenario: 'B',
    verEstelas: true,
    verPBest: false,
    verFuerzas: false,
    verMinimo: true,
    camAuto: true,
    seleccionada: 0,
    modo: 'sim',
    reto: { fase: 'humano', intentos: [] },
    enjambre: null,
    progreso: 1,
    reproduciendo: false,
    congelado: false,
    notificado: false,
    gPrevio: null,
    bufEstelas: [],
    revelados: [],
    ultimoRevelado: [],
    nieblaAlfa: 0,
    lado: 400,
    dpr: 1,
    camara: null,
    modoCam: 'auto', // auto | completa | enjambre | particula
    vistaMapa: null,
    ultimoMovCam: 0,
    ondas: [],
    mejoras: 0,
    ultimoSonido: 0,
    tInicio: 0,
    ultimoAviso: 0,
    historia: false,
    fuerzasPaso: 4, // cuántas flechas de fuerza se muestran (la narración las va revelando)
    etiquetasF: false,
    capitulo: -1, // último capítulo de la explicación que se mostró
    ocultarParticulas: false, // capítulo 1: el terreno se presenta vacío
    resaltarDominio: false, // capítulo 2: se ilumina el borde de la zona donde caen
    destacarInicial: -1, // capítulo 2: partícula cuya posición y velocidad inicial se muestran
    escalonAparicion: 28, // ms entre la aparición de una partícula y la siguiente
    camino: null, // remate final: { t0 } mientras se dibuja el camino que recorrió el gBest
    camManual: null, // vista elegida por el usuario con la rueda o arrastrando el mapa
    verRelieve: true, // sombreado del mapa según la pendiente
    verExploracion: false, // mostrar en gris lo que el enjambre nunca visitó
    nAnterior: 30, // partículas antes de activar la bandada gigante
    claveMapaGL: '', // lo último que pintó la tarjeta gráfica, para no repetir cuadros iguales
  };

  // ---------------------------------------------------------------- utilidades

  function hexARgb(hex) {
    const v = parseInt(hex.slice(1), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }

  function colorMapa(t) {
    for (let i = 1; i < PALETA.length; i++) {
      if (t <= PALETA[i][0]) {
        const [t0, c0] = PALETA[i - 1];
        const [t1, c1] = PALETA[i];
        const k = (t - t0) / (t1 - t0);
        return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
      }
    }
    return PALETA[PALETA.length - 1][1];
  }

  function crearBrillo() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255, 220, 210, 0.95)');
    gr.addColorStop(0.25, 'rgba(242, 139, 127, 0.55)');
    gr.addColorStop(1, 'rgba(242, 139, 127, 0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 64, 64);
    return c;
  }

  function dominio() {
    return FUNCIONES[estado.funcion].dominio;
  }

  function aPantalla(x, y) {
    const c = estado.camara;
    const L = estado.lado;
    return [((x - (c.cx - c.mitad)) / (2 * c.mitad)) * L, ((c.cy + c.mitad - y) / (2 * c.mitad)) * L];
  }

  function aDominio(px, py) {
    const c = estado.camara;
    const L = estado.lado;
    return [c.cx - c.mitad + (px / L) * 2 * c.mitad, c.cy + c.mitad - (py / L) * 2 * c.mitad];
  }

  // ---------------------------------------------------------------- mínimo o máximo

  function maximizando() {
    return FUNCIONES[estado.funcion].objetivo === 'max';
  }

  /** true si el valor a es mejor que b según lo que se busca (mínimo o máximo). */
  function esMejor(a, b) {
    return maximizando() ? a > b : a < b;
  }

  /**
   * Altura que se dibuja en el mapa y en el 3D. Al minimizar se usa log(1 + f − f*)
   * para que se vean los pozos pequeños; al maximizar, f tal cual, para ver montañas.
   */
  function alturaVisual(F, x, y) {
    return F.objetivo === 'max' ? F.f(x, y) : Math.log1p(Math.max(0, F.f(x, y) - F.optimo.f));
  }

  /** Palabras que cambian según se busque el mínimo o el máximo. */
  function palabras() {
    return maximizando()
      ? { extremo: 'más alto', zonas: 'claras', valor: 'más grande', direccion: 'más arriba', optimo: 'máximo global', optimos: 'máximos globales' }
      : { extremo: 'más bajo', zonas: 'oscuras', valor: 'más pequeño', direccion: 'más abajo', optimo: 'mínimo global', optimos: 'mínimos globales' };
  }

  function suavizar(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function rebote(t) {
    const s = 1.70158;
    return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);
  }

  function fmt(v, decimales = 4) {
    if (!Number.isFinite(v)) return '—';
    if (v !== 0 && Math.abs(v) < 1e-4) return v.toExponential(2);
    return v.toFixed(decimales);
  }

  function interpolar(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function posicionMostrada(p) {
    return interpolar(p.previo, p, suavizar(estado.progreso));
  }

  function gBestMostrado() {
    const E = estado.enjambre;
    if (!estado.gPrevio) return E.gBest;
    return interpolar(estado.gPrevio, E.gBest, suavizar(estado.progreso));
  }

  // ---------------------------------------------------------------- cámara

  function vistaCompleta() {
    const [a, b] = dominio();
    return { cx: (a + b) / 2, cy: (a + b) / 2, mitad: (b - a) / 2 };
  }

  function acotarVista(v, minimo = MITAD_MINIMA) {
    const [a, b] = dominio();
    const mitad = Math.min((b - a) / 2, Math.max(minimo, v.mitad));
    return {
      cx: Math.min(b - mitad, Math.max(a + mitad, v.cx)),
      cy: Math.min(b - mitad, Math.max(a + mitad, v.cy)),
      mitad,
    };
  }

  function cajaDe(puntos, margen) {
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const p of puntos) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, mitad: (Math.max(x1 - x0, y1 - y0) / 2) * margen };
  }

  function objetivoCamara() {
    const E = estado.enjambre;
    let modo = estado.modoCam;
    if (estado.modo === 'reto') return vistaCompleta();
    if (modo === 'manual') return estado.camManual || vistaCompleta(); // zoom y arrastre del usuario
    if (modo === 'auto') modo = estado.camAuto ? 'enjambre' : 'completa';
    if (modo === 'completa') return vistaCompleta();

    if (modo === 'particula') {
      const p = E.particulas[estado.seleccionada];
      if (!p || !p.fuerzas) return vistaCompleta();
      const F = p.fuerzas;
      const puntos = [p.previo, { x: p.x, y: p.y }, F.pBest, F.gBest];
      let cx = p.previo.x;
      let cy = p.previo.y;
      for (const v of [F.inercia, F.cognitiva, F.social]) {
        cx += v.x;
        cy += v.y;
        puntos.push({ x: cx, y: cy });
      }
      const caja = cajaDe(puntos, 1.45);
      caja.mitad = Math.max(caja.mitad, 0.7);
      return acotarVista(caja);
    }

    // Encuadre centrado en el gBest. El tamaño lo da el 80 % de partículas más cercanas:
    // así una sola partícula rezagada no arrastra la cámara.
    const g = gBestMostrado();
    const distancias = E.particulas
      .map((p) => {
        const pos = posicionMostrada(p);
        return Math.max(Math.abs(pos.x - g.x), Math.abs(pos.y - g.y));
      })
      .sort((a, b) => a - b);
    const radio = distancias[Math.min(distancias.length - 1, Math.floor(distancias.length * 0.8))];
    return acotarVista({ cx: g.x, cy: g.y, mitad: radio * 1.35 });
  }

  function moverCamara(dt) {
    const objetivo = objetivoCamara();
    if (estado.modoCam === 'manual' && estado.modo !== 'reto') {
      // Cuando la mueve el usuario, la cámara responde al instante, sin suavizado.
      estado.camara = { ...objetivo };
      return;
    }
    const c = estado.camara;
    const k = 1 - Math.exp(-dt / (estado.modoCam === 'particula' ? 700 : 450));
    // El zoom se interpola en escala logarítmica para que se sienta parejo.
    const mitad = Math.exp(Math.log(c.mitad) + (Math.log(objetivo.mitad) - Math.log(c.mitad)) * k);
    estado.camara = acotarVista({ cx: c.cx + (objetivo.cx - c.cx) * k, cy: c.cy + (objetivo.cy - c.cy) * k, mitad });
  }

  // ---------------------------------------------------------------- mapa

  function renderizarMapa(res) {
    const F = FUNCIONES[estado.funcion];
    const v = { ...estado.camara };
    mapa.width = mapa.height = res;
    const img = mctx.createImageData(res, res);
    const valores = new Float32Array(res * res);
    const x0 = v.cx - v.mitad;
    const y1 = v.cy + v.mitad;
    const paso = (2 * v.mitad) / res;
    let bajo = Infinity;
    let alto = -Infinity;
    for (let j = 0; j < res; j++) {
      const y = y1 - (j + 0.5) * paso;
      for (let i = 0; i < res; i++) {
        // Escala logarítmica para que se vean los pozos pequeños.
        const val = alturaVisual(F, x0 + (i + 0.5) * paso, y);
        valores[j * res + i] = val;
        if (val < bajo) bajo = val;
        if (val > alto) alto = val;
      }
    }
    const rango = alto - bajo || 1;
    const BANDAS = 6; // pocas curvas, para que no compitan con las partículas
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        const t = (valores[k] - bajo) / rango;
        let [r, g, b] = colorMapa(t);
        // Curvas de nivel suaves (como en un mapa topográfico), de ~1 píxel de grosor.
        const tx = (valores[j * res + Math.min(i + 1, res - 1)] - valores[k]) / rango;
        const ty = (valores[Math.min(j + 1, res - 1) * res + i] - valores[k]) / rango;
        const gradiente = Math.hypot(tx, ty) * BANDAS;
        const fr = t * BANDAS - Math.floor(t * BANDAS);
        const distancia = Math.min(fr, 1 - fr) / Math.max(gradiente, 1e-6);
        const linea = t > 0.03 ? Math.max(0, 1 - distancia / 0.9) : 0;
        const oscuro = 1 - 0.2 * linea;
        r *= oscuro;
        g *= oscuro;
        b *= oscuro;
        img.data[k * 4] = r;
        img.data[k * 4 + 1] = g;
        img.data[k * 4 + 2] = b;
        img.data[k * 4 + 3] = 255;
      }
    }
    mctx.putImageData(img, 0, 0);
    estado.vistaMapa = { ...v, res };
  }

  function actualizarMapa(ahora) {
    const v = estado.vistaMapa;
    const c = estado.camara;
    const cambio =
      !v ||
      Math.abs(v.cx - c.cx) > c.mitad * 0.002 ||
      Math.abs(v.cy - c.cy) > c.mitad * 0.002 ||
      Math.abs(Math.log(v.mitad / c.mitad)) > 0.004;
    if (cambio) {
      estado.ultimoMovCam = ahora;
      renderizarMapa(RES_MOVIMIENTO);
    } else if (v.res < RES_QUIETO && ahora - estado.ultimoMovCam > 220) {
      renderizarMapa(RES_QUIETO);
    }
  }

  // ---- Mapa por tarjeta gráfica (WebGL), con el dibujo por procesador como respaldo.
  const lienzoGL = $('mapa-gl');
  const mapaGL = window.MapaGL ? window.MapaGL.crear(lienzoGL) : null;
  if (mapaGL) mapaGL.fijarPaleta(PALETA);
  else lienzoGL.style.display = 'none';
  window.__mapaGL = !!mapaGL;

  function usaMapaGL() {
    return !!mapaGL && mapaGL.disponible;
  }

  /**
   * Partículas por tarjeta gráfica (con resplandor) en simulación y narración. En el reto
   * se dibujan como antes, encima de la niebla, para que no queden tapadas.
   */
  function particulasPorGL() {
    return usaMapaGL() && estado.modo !== 'reto';
  }

  // ---- Exploración: cuánto pasó el enjambre por cada zona del dominio (rejilla de 256 × 256).
  const LADO_EXP = window.MapaGL ? window.MapaGL.LADO_EXPLORACION : 256;
  const exploracion = {
    visitas: new Float32Array(LADO_EXP * LADO_EXP),
    bytes: new Uint8Array(LADO_EXP * LADO_EXP),
    maximo: 0,
    version: 0,
    cuadros: 0,
    a: -1,
    b: 1,
  };

  function reiniciarExploracion() {
    exploracion.visitas.fill(0);
    exploracion.bytes.fill(0);
    exploracion.maximo = 0;
    exploracion.version++;
    [exploracion.a, exploracion.b] = dominio();
  }

  /** Suma una visita en cada zona por donde pasa una partícula (solo mientras se mueven). */
  function acumularExploracion() {
    const E = estado.enjambre;
    if (!E || estado.ocultarParticulas || estado.progreso >= 1 || estado.congelado) return;
    const { visitas, a, b } = exploracion;
    const escala = (LADO_EXP - 1) / (b - a);
    const peso = 30 / Math.max(30, E.n); // con miles de partículas, cada una pesa menos
    for (const p of E.particulas) {
      const pos = posicionMostrada(p);
      const i = Math.round((pos.x - a) * escala);
      const j = Math.round((pos.y - a) * escala);
      if (i < 1 || j < 1 || i >= LADO_EXP - 1 || j >= LADO_EXP - 1) continue;
      const k = j * LADO_EXP + i;
      visitas[k] += peso;
      visitas[k - 1] += peso * 0.5;
      visitas[k + 1] += peso * 0.5;
      visitas[k - LADO_EXP] += peso * 0.5;
      visitas[k + LADO_EXP] += peso * 0.5;
      if (visitas[k] > exploracion.maximo) exploracion.maximo = visitas[k];
    }
    // Pasar a bytes para la tarjeta gráfica cada 4 cuadros basta y es barato.
    if (++exploracion.cuadros % 4 !== 0 || !exploracion.maximo) return;
    const norma = 255 / Math.log1p(exploracion.maximo);
    for (let k = 0; k < visitas.length; k++) exploracion.bytes[k] = Math.min(255, Math.log1p(visitas[k]) * norma);
    exploracion.version++;
  }

  // ---- Puntos que la tarjeta gráfica dibuja con brillo: [x, y, tamaño, opacidad, tipo] cada uno.
  const DATOS_PUNTO = window.MapaGL ? window.MapaGL.DATOS_POR_PUNTO : 5;
  let bufferPuntos2D = new Float32Array(0);
  let bufferPuntos3D = new Float32Array(0);

  function asegurarBuffer(actual, puntos) {
    return actual.length >= puntos * DATOS_PUNTO ? actual : new Float32Array(puntos * DATOS_PUNTO * 2);
  }

  /** Separación entre la aparición de una partícula y la siguiente (con miles, aparecen casi a la vez). */
  function escalonEfectivo() {
    return Math.min(estado.escalonAparicion, 1600 / Math.max(1, estado.enjambre.n));
  }

  /** Aparición animada de una partícula: progreso de 0 a 1. */
  function progresoAparicion(p, ahora) {
    return Math.min(1, Math.max(0, (ahora - estado.tInicio - p.id * escalonEfectivo()) / 550));
  }

  function enjambreVisible() {
    const enReto = estado.modo === 'reto';
    return (!enReto || estado.reto.fase === 'enjambre' || estado.reto.fase === 'fin') && !estado.ocultarParticulas;
  }

  /** Partículas del mapa 2D y el halo pulsante del gBest. Devuelve cuántos puntos hay. */
  function construirPuntos2D(ahora) {
    const E = estado.enjambre;
    if (!enjambreVisible()) return 0;
    bufferPuntos2D = asegurarBuffer(bufferPuntos2D, E.n + 1);
    const datos = bufferPuntos2D;
    const porPixel = (2 * estado.camara.mitad) / estado.lado; // unidades de la función por píxel
    const grande = E.n > 200;
    let k = 0;
    for (const p of E.particulas) {
      const t = progresoAparicion(p, ahora);
      if (t <= 0) continue;
      const pos = posicionMostrada(p);
      const caida = estado.escalonAparicion > 50 ? (1 - suavizar(t)) * 60 : 0;
      datos[k++] = pos.x;
      datos[k++] = pos.y + caida * porPixel;
      datos[k++] = (grande ? 14 : 36) * rebote(t);
      datos[k++] = t * (grande ? 0.7 : 1);
      datos[k++] = 0;
    }
    const g = gBestMostrado();
    datos[k++] = g.x;
    datos[k++] = g.y;
    datos[k++] = 90 * (1 + 0.2 * Math.sin(ahora / 240));
    datos[k++] = 1;
    datos[k++] = 1;
    return k / DATOS_PUNTO;
  }

  /** Partículas del 3D (la tarjeta gráfica las posa sobre la superficie y las tapa con las montañas). */
  function construirPuntos3D() {
    const E = estado.enjambre;
    if (!enjambreVisible()) return 0;
    bufferPuntos3D = asegurarBuffer(bufferPuntos3D, E.n + 1);
    const datos = bufferPuntos3D;
    const grande = E.n > 200;
    let k = 0;
    for (const p of E.particulas) {
      const pos = posicionMostrada(p);
      datos[k++] = pos.x;
      datos[k++] = pos.y;
      datos[k++] = grande ? 9 : 20;
      datos[k++] = grande ? 0.7 : 1;
      datos[k++] = 0;
    }
    const g = gBestMostrado();
    datos[k++] = g.x;
    datos[k++] = g.y;
    datos[k++] = 46;
    datos[k++] = 1;
    datos[k++] = 1;
    return k / DATOS_PUNTO;
  }

  /** Mapa (recalculado solo si cambió la cámara) y partículas con resplandor, por tarjeta gráfica. */
  function dibujarMapaGL(ahora) {
    const c = estado.camara;
    const F = FUNCIONES[estado.funcion];
    const cantidad = particulasPorGL() ? construirPuntos2D(ahora) : 0;
    mapaGL.dibujar({
      funcion: estado.funcion,
      cx: c.cx,
      cy: c.cy,
      mitad: c.mitad,
      maximizar: F.objetivo === 'max',
      optimo: F.optimo.f,
      bajo: malla.bajo,
      rango: malla.rango,
      bandas: 6,
      relieve: estado.verRelieve,
      explorar: estado.verExploracion && estado.modo !== 'reto',
      exploracion,
      puntos: bufferPuntos2D,
      cantidad,
      dpr: estado.dpr,
    });
  }

  function prepararFuncion() {
    estado.camara = vistaCompleta();
    estado.vistaMapa = null;
    reiniciarExploracion();
    $('formula').textContent = FUNCIONES[estado.funcion].formula;
    $('leyenda-3d').textContent = maximizando() ? '(altura = f)' : '(altura = log(1 + f))';
  }

  function ajustarTamano() {
    const caja = $('escenario').getBoundingClientRect();
    const estilo = getComputedStyle($('escenario'));
    const ancho = caja.width - parseFloat(estilo.paddingLeft) - parseFloat(estilo.paddingRight);
    const alto = caja.height - parseFloat(estilo.paddingTop) - parseFloat(estilo.paddingBottom);
    const anchoLateral = $('lateral').getBoundingClientRect().width;
    const libre = ancho - (anchoLateral ? anchoLateral + parseFloat(estilo.columnGap || 0) : 0);
    const lado = Math.max(220, Math.floor(Math.min(libre, alto)));
    const dpr = densidad();
    estado.lado = lado;
    estado.dpr = dpr;
    lienzo.style.width = lienzo.style.height = lado + 'px';
    lienzo.width = lienzo.height = Math.round(lado * dpr);
    // El mapa WebGL va debajo, exactamente del mismo tamaño.
    lienzoGL.style.width = lienzoGL.style.height = lado + 'px';
    lienzoGL.width = lienzoGL.height = lienzo.width;
    estado.claveMapaGL = '';
    niebla.width = niebla.height = lienzo.width;
    redibujarNiebla();
    dibujarGrafica();
  }

  // ---------------------------------------------------------------- niebla del reto

  function redibujarNiebla() {
    nctx.setTransform(1, 0, 0, 1, 0, 0);
    nctx.globalCompositeOperation = 'source-over';
    nctx.clearRect(0, 0, niebla.width, niebla.height);
    nctx.fillStyle = 'rgba(2, 8, 11, 0.97)';
    nctx.fillRect(0, 0, niebla.width, niebla.height);
    for (const r of estado.revelados) pintarRevelado(r);
  }

  function pintarRevelado(r) {
    const [sx, sy] = aPantalla(r.x, r.y);
    const d = estado.dpr;
    const R = r.radio * estado.lado * d;
    const g = nctx.createRadialGradient(sx * d, sy * d, 0, sx * d, sy * d, R);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(0.55, 'rgba(0, 0, 0, 0.85)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    nctx.globalCompositeOperation = 'destination-out';
    nctx.fillStyle = g;
    nctx.beginPath();
    nctx.arc(sx * d, sy * d, R, 0, Math.PI * 2);
    nctx.fill();
    nctx.globalCompositeOperation = 'source-over';
  }

  function revelar(x, y, radio) {
    const r = { x, y, radio };
    estado.revelados.push(r);
    pintarRevelado(r);
  }

  // ---------------------------------------------------------------- subtítulos

  let temporizadorSubtitulo = null;

  function subtitulo(html, ms = 3000) {
    const s = $('subtitulo');
    clearTimeout(temporizadorSubtitulo);
    s.innerHTML = html;
    s.classList.add('visible');
    if (ms > 0) temporizadorSubtitulo = setTimeout(() => s.classList.remove('visible'), ms);
  }

  function ocultarSubtitulo() {
    clearTimeout(temporizadorSubtitulo);
    $('subtitulo').classList.remove('visible');
  }

  // ---------------------------------------------------------------- ciclo de la simulación

  function reiniciar() {
    estado.enjambre = new Enjambre({
      funcion: estado.funcion,
      n: estado.n,
      w: estado.w,
      c1: estado.c1,
      c2: estado.c2,
      decaimiento: estado.decaimiento,
      semilla: estado.semilla,
      maxIter: estado.maxIter,
    });
    estado.progreso = 1;
    estado.reproduciendo = false;
    estado.congelado = false;
    estado.notificado = false;
    estado.gPrevio = null;
    estado.ondas = [];
    estado.mejoras = 0;
    estado.tInicio = performance.now();
    estado.ocultarParticulas = false;
    estado.resaltarDominio = false;
    estado.destacarInicial = -1;
    estado.escalonAparicion = 28;
    estado.camino = null;
    estado.verExploracion = $('chk-exploracion').checked;
    reiniciarExploracion();
    $('resumen').classList.remove('visible');
    if (!estado.historia) {
      estado.modoCam = 'auto';
      Sonido.aparicion(); // en la narración, cada capítulo pone sus propios sonidos
    }
    estado.bufEstelas = estado.enjambre.particulas.map(() => []);
    estado.ultimoRevelado = estado.enjambre.particulas.map(() => null);
    if (!estado.camara) estado.camara = vistaCompleta();
    if (estado.seleccionada >= estado.n) estado.seleccionada = 0;
    if (!estado.historia) ocultarSubtitulo();
    actualizarPanel();
    dibujarGrafica();
  }

  function avanzar() {
    const E = estado.enjambre;
    if (E.terminado) return;
    const antes = E.gBest.f;
    estado.gPrevio = { x: E.gBest.x, y: E.gBest.y };
    E.paso();
    estado.progreso = 0;

    if (esMejor(E.gBest.f, antes) && Math.abs(E.gBest.f - antes) > 1e-12) {
      const ahora = performance.now();
      estado.ondas.push({ x: E.gBest.x, y: E.gBest.y, t0: ahora });
      if (ahora - estado.ultimoSonido > 90) {
        estado.ultimoSonido = ahora;
        Sonido.mejora(estado.mejoras++);
      }
      const puedeAvisar = !estado.historia && estado.modo === 'sim' && estado.iterPorSegundo <= 10;
      if (puedeAvisar && ahora - estado.ultimoAviso > 1400) {
        estado.ultimoAviso = ahora;
        subtitulo(`¡Nuevo mejor global! f = <b>${fmt(E.gBest.f)}</b>`, 1600);
      }
    }
    actualizarPanel();
    dibujarGrafica();
  }

  function alternarReproduccion() {
    const E = estado.enjambre;
    if (estado.modo === 'reto' && estado.reto.fase !== 'enjambre') return;
    if (E.terminado) return;
    estado.ocultarParticulas = false;
    estado.reproduciendo = !estado.reproduciendo;
    actualizarPanel();
  }

  function pasoManual() {
    if (estado.modo === 'reto') return;
    estado.ocultarParticulas = false;
    estado.reproduciendo = false;
    if (estado.progreso < 1) estado.progreso = 1;
    avanzar();
  }

  function alTerminar() {
    const E = estado.enjambre;
    estado.reproduciendo = false;
    if (estado.modo === 'reto') {
      estado.reto.fase = 'fin';
      const h = mejorHumano();
      const ganoEnjambre = esMejor(E.gBest.f, h.f);
      Sonido.final();
      mostrarAviso(
        ganoEnjambre ? 'Ganó el enjambre' : '¡Le ganaste al enjambre!',
        `Tú: f = ${fmt(h.f)} con ${estado.reto.intentos.length} intentos.<br>` +
          `Enjambre: f = ${fmt(E.gBest.f)} con ${E.evaluaciones.toLocaleString('es-CO')} evaluaciones.<br>` +
          'Ninguna partícula conocía la respuesta: la encontraron compartiendo información.',
        { texto: 'Jugar otra vez', accion: () => { nuevaSemilla(); iniciarReto(); } }
      );
    } else if (!estado.historia) {
      Sonido.final();
      const g = E.gBest;
      subtitulo(`Fin: mejor f = <b>${fmt(g.f)}</b> en (${g.x.toFixed(3)}, ${g.y.toFixed(3)})`, 0);
    }
    actualizarPanel();
  }

  let ultimoTiempo = performance.now();

  let erroresDeCuadro = 0;

  /** Ciclo de animación. Si un cuadro falla, se registra y la animación sigue. */
  // Tiempo que tarda el código en preparar cada cuadro (ver window.__rendimiento en la consola).
  const rendimiento = { cuadros: 0, totalMs: 0, peorMs: 0 };
  window.__rendimiento = rendimiento;

  function cuadro() {
    const inicio = performance.now();
    try {
      pintarCuadro();
    } catch (err) {
      if (erroresDeCuadro++ < 5) console.error('Error al dibujar un cuadro:', err);
    }
    const ms = performance.now() - inicio;
    rendimiento.cuadros++;
    rendimiento.totalMs += ms;
    if (ms > rendimiento.peorMs) rendimiento.peorMs = ms;
    requestAnimationFrame(cuadro);
  }

  /** Mide cuánto tarda una parte del cuadro (promedio y peor caso en window.__rendimiento.partes). */
  rendimiento.partes = {};
  function medir(nombre, accion) {
    const t0 = performance.now();
    accion();
    const ms = performance.now() - t0;
    const p = rendimiento.partes[nombre] || (rendimiento.partes[nombre] = { veces: 0, totalMs: 0, peorMs: 0 });
    p.veces++;
    p.totalMs += ms;
    if (ms > p.peorMs) p.peorMs = ms;
  }

  function pintarCuadro() {
    // Se usa performance.now() en todo el archivo para que los tiempos sean comparables.
    const ahora = performance.now();
    const dt = Math.min(100, Math.max(0, ahora - ultimoTiempo));
    ultimoTiempo = ahora;
    const E = estado.enjambre;

    if (!estado.congelado) {
      if (estado.progreso < 1) {
        estado.progreso = Math.min(1, estado.progreso + dt / (1000 / estado.iterPorSegundo));
      } else if (estado.reproduciendo && !E.terminado) {
        medir('iteración', avanzar);
      } else if (E.terminado && !estado.notificado) {
        estado.notificado = true;
        alTerminar();
      }
    }

    if (estado.modo === 'reto' && estado.reto.fase === 'fin' && estado.nieblaAlfa > 0) {
      estado.nieblaAlfa = Math.max(0, estado.nieblaAlfa - dt / 1800);
    }

    // La música suena mientras algo se mueve y se apaga en pausa, para no tapar al expositor.
    Sonido.musicaActiva(estado.historia || estado.reproduciendo);
    if (!estado.historia) Sonido.intensidad(estado.iterPorSegundo >= 10 ? 0.8 : 0.45);

    moverCamara(dt);
    medir('mallas', actualizarMallas); // también dan el rango de alturas de la zona visible
    acumularExploracion();
    medir('mapa', () => (usaMapaGL() ? dibujarMapaGL(ahora) : actualizarMapa(ahora)));
    actualizarEstelas();
    medir('partículas', () => dibujar(ahora));
    if (lateralVisible() || grande3dVisible()) medir('3D', () => dibujar3D(dt));
    if (lateralVisible()) {
      medir('corte', dibujarCorte);
      actualizarFormulaViva();
    }
    actualizarZoom();
  }

  // ---------------------------------------------------------------- vista 3D

  const vista3d = $('vista3d');
  let v3 = null; // contexto donde se está pintando el 3D (vista pequeña o grande)
  const corte = $('corte');
  const cctx = corte.getContext('2d');
  const N3 = 46; // vértices por lado de la malla 3D
  const N3_GRANDE = 92; // malla más fina para la vista 3D grande
  let mallaFina = null;
  const ELEVACION = 0.6; // inclinación de la vista automática, en radianes
  const LUZ = (() => {
    const l = [-0.45, -0.35, 0.82];
    const n = Math.hypot(...l);
    return l.map((v) => v / n);
  })();
  let malla = null;
  let angulo3d = -0.6;
  let tiempo3d = 0;

  function lateralVisible() {
    return !$('lateral').classList.contains('oculto') && estado.modo !== 'reto';
  }

  // El tamaño de cada lienzo se anota cuando cambia (ResizeObserver), en vez de
  // medir la página en cada cuadro, que obliga al navegador a recalcular el diseño.
  const tamanos = new Map();
  const observadorTamano = new ResizeObserver((entradas) => {
    for (const e of entradas) tamanos.set(e.target, { width: e.contentRect.width, height: e.contentRect.height });
  });

  /** Densidad de píxeles, con tope de 2: más que eso cuesta mucho y casi no se nota. */
  function densidad() {
    return Math.min(2, window.devicePixelRatio || 1);
  }

  /** Tamaño anotado de un lienzo (se mide una sola vez y luego lo mantiene el observador). */
  function tamanoDe(c) {
    if (!tamanos.has(c)) {
      observadorTamano.observe(c);
      const inicial = c.getBoundingClientRect();
      tamanos.set(c, { width: inicial.width, height: inicial.height });
    }
    return tamanos.get(c);
  }

  // Solo se escribe en la página cuando el texto cambia: cada escritura puede costar un recálculo.
  const escritos = new Map();
  function escribir(id, valor, comoHtml = false) {
    if (escritos.get(id) === valor) return;
    escritos.set(id, valor);
    if (comoHtml) $(id).innerHTML = valor;
    else $(id).textContent = valor;
  }

  function prepararLienzo(c, contexto) {
    if (!tamanos.has(c)) {
      observadorTamano.observe(c);
      const inicial = c.getBoundingClientRect();
      tamanos.set(c, { width: inicial.width, height: inicial.height });
    }
    const r = tamanos.get(c);
    if (!r.width) return null;
    const dpr = densidad();
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    contexto.setTransform(dpr, 0, 0, dpr, 0, 0);
    contexto.clearRect(0, 0, r.width, r.height);
    return { W: r.width, H: r.height };
  }

  function alturaLog(F, x, y) {
    return alturaVisual(F, x, y);
  }

  // La malla cubre la misma zona que el mapa: si la cámara hace zoom, el 3D también.
  function construirMalla(n) {
    const F = FUNCIONES[estado.funcion];
    const c = { ...estado.camara };
    const z = new Float32Array(n * n);
    let bajo = Infinity;
    let alto = -Infinity;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = c.cx - c.mitad + (2 * c.mitad * i) / (n - 1);
        const y = c.cy - c.mitad + (2 * c.mitad * j) / (n - 1);
        const v = alturaLog(F, x, y);
        z[j * n + i] = v;
        if (v < bajo) bajo = v;
        if (v > alto) alto = v;
      }
    }
    const rango = alto - bajo || 1;

    // Lo que no depende del ángulo de la vista se calcula una sola vez por malla:
    // la altura normalizada de cada vértice y el color (con su luz) de cada cara.
    const t = new Float32Array(n * n);
    for (let k = 0; k < t.length; k++) t[k] = (z[k] - bajo) / rango;
    const m1 = n - 1;
    const paso = 2 / m1;
    const colores = new Array(m1 * m1);
    for (let j = 0; j < m1; j++) {
      for (let i = 0; i < m1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const cc = a + n + 1;
        const d = a + n;
        const dzx = (((t[b] + t[cc]) - (t[a] + t[d])) / 2) * 0.8 / paso;
        const dzy = (((t[d] + t[cc]) - (t[a] + t[b])) / 2) * 0.8 / paso;
        const norma = Math.hypot(dzx, dzy, 1);
        const luz = 0.45 + 0.55 * Math.max(0, (-dzx * LUZ[0] - dzy * LUZ[1] + LUZ[2]) / norma);
        const [r, g, bl] = colorMapa(Math.min(1, Math.max(0, (t[a] + t[b] + t[cc] + t[d]) / 4)));
        colores[j * m1 + i] = `rgb(${(r * luz) | 0}, ${(g * luz) | 0}, ${(bl * luz) | 0})`;
      }
    }
    return {
      n,
      vista: c,
      funcion: estado.funcion,
      z,
      bajo,
      rango,
      t,
      colores,
      // Memoria reutilizada en cada cuadro: vértices proyectados y orden de las caras.
      px: new Float32Array(n * n),
      py: new Float32Array(n * n),
      pz: new Float32Array(n * n),
      profundidad: new Float32Array(m1 * m1),
      orden: Uint32Array.from({ length: m1 * m1 }, (_, i) => i),
    };
  }

  function mallaVigente() {
    const m = malla;
    const c = estado.camara;
    return (
      m &&
      m.funcion === estado.funcion &&
      Math.abs(m.vista.cx - c.cx) <= c.mitad * 0.004 &&
      Math.abs(m.vista.cy - c.cy) <= c.mitad * 0.004 &&
      Math.abs(Math.log(m.vista.mitad / c.mitad)) <= 0.008
    );
  }

  /** Altura normalizada de un punto: 0 es lo más bajo de la zona visible y 1 lo más alto. */
  function altura01(x, y) {
    const t = (alturaLog(FUNCIONES[estado.funcion], x, y) - malla.bajo) / malla.rango;
    return Math.max(-0.05, Math.min(1.25, t));
  }

  function aMundo(x, y) {
    const c = malla.vista;
    return [(x - c.cx) / c.mitad, (y - c.cy) / c.mitad];
  }

  // El 3D gira solo, o lo mueve el usuario: arrastrar gira, la rueda acerca y el doble clic
  // vuelve al giro automático. Senos y cosenos se calculan una vez por cuadro.
  const ctl3d = { manual: false, elevacion: ELEVACION, zoom: 1 };
  let ca3 = Math.cos(angulo3d);
  let sa3 = Math.sin(angulo3d);
  let ce3 = Math.cos(ELEVACION);
  let se3 = Math.sin(ELEVACION);

  function proyectar(X, Y, Z, marco) {
    const xr = X * ca3 - Y * sa3;
    const yr = X * sa3 + Y * ca3;
    const zh = Z * 0.8 - 0.35;
    const profundidad = yr * ce3 - zh * se3;
    const escala = marco.esc / (1 + profundidad * 0.12);
    return [marco.W / 2 + xr * escala, marco.cy - (yr * se3 + zh * ce3) * escala, profundidad];
  }

  function puntoSobreSuperficie(x, y, marco, elevar = 0.02) {
    const [X, Y] = aMundo(x, y);
    if (Math.abs(X) > 1.02 || Math.abs(Y) > 1.02) return null;
    return proyectar(X, Y, altura01(x, y) + elevar, marco);
  }

  function lineaSobreSuperficie(a, b, color, ancho, marco) {
    v3.save();
    v3.strokeStyle = color;
    v3.lineWidth = ancho;
    v3.lineCap = 'round';
    v3.beginPath();
    let empezada = false;
    for (let k = 0; k <= 30; k++) {
      const u = k / 30;
      const q = puntoSobreSuperficie(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, marco, 0.03);
      if (!q) {
        empezada = false;
        continue;
      }
      if (empezada) v3.lineTo(q[0], q[1]);
      else v3.moveTo(q[0], q[1]);
      empezada = true;
    }
    v3.stroke();
    v3.restore();
  }

  // ---- 3D grande: se superpone al mapa unos segundos al presentar la función.
  const grande3d = $('vista3d-grande');
  const cajaGrande3d = $('caja-3d-grande');
  const contextoGrande = grande3d.getContext('2d');
  const contextoPequeno = vista3d.getContext('2d');

  // La superficie la dibuja la tarjeta gráfica en un lienzo debajo; encima van las partículas.
  // Si no hay WebGL, estas variables quedan en null y se usa la malla por procesador.
  const lienzoSuperficie = { pequena: $('vista3d-gl'), grande: $('vista3d-grande-gl') };
  const superficie3d = {
    pequena: window.MapaGL ? window.MapaGL.crearSuperficie(lienzoSuperficie.pequena, 128) : null,
    grande: window.MapaGL ? window.MapaGL.crearSuperficie(lienzoSuperficie.grande, 160) : null,
  };
  for (const clave of ['pequena', 'grande']) {
    if (superficie3d[clave]) superficie3d[clave].fijarPaleta(PALETA);
    else lienzoSuperficie[clave].style.display = 'none';
  }

  let particulas3DenGL = false; // si en este cuadro la tarjeta gráfica ya dibujó las partículas del 3D

  function usaSuperficieGL(clave) {
    return !!superficie3d[clave] && superficie3d[clave].disponible;
  }
  let grandeVisibleHasta = 0;
  let temporizadorGrande = null;

  function mostrar3DGrande(visible, duracionMs = 0) {
    clearTimeout(temporizadorGrande);
    cajaGrande3d.classList.toggle('visible', visible);
    $('btn-ampliar-3d').textContent = visible ? 'Reducir' : 'Ampliar';
    // Al ocultarse se sigue dibujando 800 ms mientras se desvanece.
    grandeVisibleHasta = visible ? Infinity : performance.now() + 800;
    if (visible) Sonido.barrido(true);
    if (visible && duracionMs > 0) temporizadorGrande = setTimeout(() => mostrar3DGrande(false), duracionMs);
  }

  function grande3dVisible() {
    return estado.modo !== 'reto' && performance.now() < grandeVisibleHasta;
  }

  function actualizarMallas() {
    if (!mallaVigente()) {
      malla = construirMalla(N3);
      mallaFina = null;
    }
    // Solo sin tarjeta gráfica: la vista grande usa una malla más fina, para que no se noten las caras.
    if (grande3dVisible() && !mallaFina && !usaSuperficieGL('grande')) mallaFina = construirMalla(N3_GRANDE);
  }

  function dibujar3D(dt) {
    if (!ctl3d.manual) {
      // Oscila despacio alrededor de una vista en diagonal (de frente se ve como una lámina);
      // en la cámara lenta casi se detiene para poder explicar.
      tiempo3d += dt * (estado.modoCam === 'particula' ? 0.15 : 1);
      const objetivo = -0.62 + 0.42 * Math.sin(tiempo3d * 0.00022);
      // Si el usuario acaba de soltar el control, vuelve suavemente a la vista automática.
      const k = 1 - Math.exp(-dt / 280);
      angulo3d += (objetivo - angulo3d) * k;
      ctl3d.elevacion += (ELEVACION - ctl3d.elevacion) * k;
      ctl3d.zoom += (1 - ctl3d.zoom) * k;
    }
    ca3 = Math.cos(angulo3d);
    sa3 = Math.sin(angulo3d);
    ce3 = Math.cos(ctl3d.elevacion);
    se3 = Math.sin(ctl3d.elevacion);
    if (lateralVisible()) pintar3D(vista3d, contextoPequeno, false);
    if (grande3dVisible()) pintar3D(grande3d, contextoGrande, true);
  }

  function pintar3D(lienzo3d, contexto, grande) {
    v3 = contexto;
    const marco = prepararLienzo(lienzo3d, v3);
    if (!marco) return;
    marco.esc = Math.min(marco.W, marco.H * 1.25) * (grande ? 0.4 : 0.36) * ctl3d.zoom;
    marco.cy = marco.H * (grande ? 0.56 : 0.5);

    const clave = grande ? 'grande' : 'pequena';
    if (usaSuperficieGL(clave)) {
      // La tarjeta gráfica dibuja la superficie en el lienzo de abajo, con la misma proyección.
      const lienzoGL3 = lienzoSuperficie[clave];
      if (lienzoGL3.width !== lienzo3d.width || lienzoGL3.height !== lienzo3d.height) {
        lienzoGL3.width = lienzo3d.width;
        lienzoGL3.height = lienzo3d.height;
      }
      const F = FUNCIONES[estado.funcion];
      superficie3d[clave].dibujar({
        funcion: estado.funcion,
        cx: malla.vista.cx,
        cy: malla.vista.cy,
        mitad: malla.vista.mitad,
        maximizar: F.objetivo === 'max',
        optimo: F.optimo.f,
        bajo: malla.bajo,
        rango: malla.rango,
        ca: ca3,
        sa: sa3,
        ce: ce3,
        se: se3,
        escala: marco.esc,
        centroX: marco.W / 2,
        centroY: marco.cy,
        ancho: marco.W,
        alto: marco.H,
        puntos: bufferPuntos3D,
        cantidad: construirPuntos3D(),
        dpr: densidad(),
      });
      particulas3DenGL = true;
    } else {
      dibujarMallaPorProcesador(grande, marco);
      particulas3DenGL = false;
    }

    // Mínimos globales.
    dibujarOptimos3D(marco);

    // En el capítulo 1 el terreno se presenta vacío.
    if (!estado.ocultarParticulas) dibujarEnjambre3D(marco);
    if (grande) dibujarTitulo3D(marco);
  }

  /** Respaldo sin WebGL: la superficie como polígonos dibujados uno por uno. */
  function dibujarMallaPorProcesador(grande, marco) {
    // Vértices proyectados (misma fórmula que proyectar(), escrita aquí para no crear objetos).
    const M = grande && mallaFina ? mallaFina : malla;
    const { n, t, px, py, pz, profundidad, orden, colores } = M;
    const m1 = n - 1;
    const mitadW = marco.W / 2;
    for (let j = 0; j < n; j++) {
      const Y = -1 + (2 * j) / m1;
      for (let i = 0; i < n; i++) {
        const X = -1 + (2 * i) / m1;
        const k = j * n + i;
        const xr = X * ca3 - Y * sa3;
        const yr = X * sa3 + Y * ca3;
        const zh = t[k] * 0.8 - 0.35;
        const prof = yr * ce3 - zh * se3;
        const escala = marco.esc / (1 + prof * 0.12);
        px[k] = mitadW + xr * escala;
        py[k] = marco.cy - (yr * se3 + zh * ce3) * escala;
        pz[k] = prof;
      }
    }

    // Caras de atrás hacia adelante (algoritmo del pintor). El orden casi no cambia
    // de un cuadro al siguiente, así que reordenar el mismo arreglo es rápido.
    for (let j = 0; j < m1; j++) {
      for (let i = 0; i < m1; i++) {
        const a = j * n + i;
        profundidad[j * m1 + i] = pz[a] + pz[a + 1] + pz[a + n + 1] + pz[a + n];
      }
    }
    orden.sort((p, q) => profundidad[q] - profundidad[p]);

    v3.lineWidth = 0.6;
    for (let s = 0; s < orden.length; s++) {
      const cara = orden[s];
      const j = (cara / m1) | 0;
      const a = j * n + (cara - j * m1);
      const b = a + 1;
      const c = a + n + 1;
      const d = a + n;
      v3.fillStyle = v3.strokeStyle = colores[cara];
      v3.beginPath();
      v3.moveTo(px[a], py[a]);
      v3.lineTo(px[b], py[b]);
      v3.lineTo(px[c], py[c]);
      v3.lineTo(px[d], py[d]);
      v3.closePath();
      v3.fill();
      v3.stroke();
    }
  }

  /** Rombos que marcan los óptimos globales sobre la superficie. */
  function dibujarOptimos3D(marco) {
    for (const m of FUNCIONES[estado.funcion].optimos) {
      const q = puntoSobreSuperficie(m.x, m.y, marco);
      if (!q) continue;
      v3.strokeStyle = 'rgba(255, 255, 255, 0.9)';
      v3.lineWidth = 1.4;
      v3.beginPath();
      v3.moveTo(q[0], q[1] - 6);
      v3.lineTo(q[0] + 6, q[1]);
      v3.lineTo(q[0], q[1] + 6);
      v3.lineTo(q[0] - 6, q[1]);
      v3.closePath();
      v3.stroke();
    }
  }

  function dibujarEnjambre3D(marco) {
    const E = estado.enjambre;
    const conFuerzas = estado.verFuerzas && estado.modo === 'sim';

    // Fuerzas de la partícula seleccionada, dibujadas sobre la superficie.
    const sel = E.particulas[estado.seleccionada];
    if (conFuerzas && sel && sel.fuerzas) {
      const pts = puntosCadena(sel);
      [COLOR.azul, COLOR.verde, COLOR.salmon].forEach((color, i) => {
        if (i < estado.fuerzasPaso) lineaSobreSuperficie(pts[i], pts[i + 1], color, 3, marco);
      });
      if (estado.fuerzasPaso >= 4) lineaSobreSuperficie(sel.previo, sel, '#ffffff', 3.4, marco);
      pts.slice(0, Math.min(estado.fuerzasPaso, 3) + 1).forEach((pt, i) => {
        const q = puntoSobreSuperficie(pt.x, pt.y, marco, 0.04);
        if (!q) return;
        v3.fillStyle = i === 0 ? '#ffffff' : [COLOR.azul, COLOR.verde, COLOR.salmon][i - 1];
        v3.beginPath();
        v3.arc(q[0], q[1], 4, 0, Math.PI * 2);
        v3.fill();
      });
    }

    // Partículas posadas sobre la superficie (solo sin tarjeta gráfica; con ella ya están
    // dibujadas dentro de la escena). El brillo es una imagen ya preparada.
    v3.fillStyle = COLOR.nucleo;
    if (!particulas3DenGL) E.particulas.forEach((p, i) => {
      const pos = posicionMostrada(p);
      const q = puntoSobreSuperficie(pos.x, pos.y, marco);
      if (!q) return;
      const radio = conFuerzas && i === estado.seleccionada ? 5 : 3;
      v3.drawImage(brillo, q[0] - radio * 3.2, q[1] - radio * 3.2, radio * 6.4, radio * 6.4);
      v3.beginPath();
      v3.arc(q[0], q[1], radio, 0, Math.PI * 2);
      v3.fill();
    });

    if (conFuerzas && sel) {
      const pos = posicionMostrada(sel);
      const q = puntoSobreSuperficie(pos.x, pos.y, marco);
      if (q) {
        v3.strokeStyle = '#ffffff';
        v3.lineWidth = 2;
        v3.beginPath();
        v3.arc(q[0], q[1], 9, 0, Math.PI * 2);
        v3.stroke();
      }
    }

    const g = gBestMostrado();
    const qg = particulas3DenGL ? null : puntoSobreSuperficie(g.x, g.y, marco, 0.03);
    if (qg) {
      v3.strokeStyle = COLOR.salmon;
      v3.lineWidth = 2.2;
      v3.beginPath();
      v3.arc(qg[0], qg[1], 8, 0, Math.PI * 2);
      v3.stroke();
    }
  }

  /** Nombre y fórmula de la función sobre el 3D grande. */
  function dibujarTitulo3D(marco) {
    {
      const F = FUNCIONES[estado.funcion];
      v3.textAlign = 'center';
      v3.fillStyle = COLOR.salmon;
      v3.font = '700 34px "Segoe UI", system-ui, sans-serif';
      v3.fillText(F.nombre.toUpperCase(), marco.W / 2, 112);
      v3.fillStyle = 'rgba(242, 236, 228, 0.85)';
      v3.font = '15px Consolas, "Cascadia Mono", monospace';
      v3.fillText(F.formula, marco.W / 2, 142);
      v3.font = '13px "Segoe UI", system-ui, sans-serif';
      v3.fillStyle = 'rgba(159, 184, 176, 0.9)';
      v3.fillText(F.objetivo === 'max' ? 'altura = f(x, y)' : 'altura = log(1 + f(x, y))', marco.W / 2, 164);
    }
  }

  // ---------------------------------------------------------------- corte de la función

  /** Puntos por los que pasa la suma de fuerzas: inicio, +inercia, +cognitiva, +social. */
  function puntosCadena(p) {
    const F = p.fuerzas;
    const pts = [{ x: p.previo.x, y: p.previo.y }];
    let cx = p.previo.x;
    let cy = p.previo.y;
    for (const v of [F.inercia, F.cognitiva, F.social]) {
      cx += v.x;
      cy += v.y;
      pts.push({ x: cx, y: cy });
    }
    return pts;
  }

  let tituloCorte = '';

  function dibujarCorte() {
    const marco = prepararLienzo(corte, cctx);
    if (!marco) return;
    const { W, H } = marco;
    const m = { l: 48, r: 14, t: 26, b: 22 };
    const E = estado.enjambre;
    const F = FUNCIONES[estado.funcion];
    const p = E.particulas[estado.seleccionada];
    const recorrido = estado.verFuerzas && estado.modo === 'sim' && p && p.fuerzas;
    const tramos = []; // cada tramo: { puntos: [{s, f}], color }
    const marcas = []; // { s, f, texto, color }
    let titulo;
    let nota = '';

    if (recorrido) {
      // f a lo largo del camino que forman las tres fuerzas encadenadas.
      titulo = `Recorrido del salto · partícula #${p.id + 1}`;
      const pts = puntosCadena(p);
      const colores = [COLOR.azul, COLOR.verde, COLOR.salmon];
      const nombres = ['inercia', 'cognitiva', 'social'];
      marcas.push({ s: 0, f: p.fuerzas.fAntes, texto: 'inicio', color: '#ffffff' });
      let s = 0;
      for (let i = 0; i < 3; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const largo = Math.hypot(b.x - a.x, b.y - a.y);
        const visible = i < estado.fuerzasPaso;
        const puntos = [];
        for (let k = 0; k <= 50; k++) {
          const u = k / 50;
          puntos.push({ s: s + largo * u, f: F.f(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u) });
        }
        tramos.push({ puntos, color: visible ? colores[i] : 'rgba(255, 255, 255, 0.14)' });
        s += largo;
        if (visible) marcas.push({ s, f: F.f(b.x, b.y), texto: '+' + nombres[i], color: colores[i] });
      }
      if (estado.fuerzasPaso >= 4) nota = `salto real: f ${fmt(p.fuerzas.fAntes, 2)} → ${fmt(p.f, 2)}`;
    } else {
      // Corte horizontal que pasa por el gBest (o por el centro, si todavía no hay enjambre).
      const c = estado.camara;
      const sinEnjambre = estado.ocultarParticulas;
      const g = sinEnjambre ? { x: c.cx, y: c.cy } : gBestMostrado();
      titulo = sinEnjambre ? `Corte en y = ${num(g.y)}` : `Corte en y = ${num(g.y)} (por el gBest)`;
      const puntos = [];
      for (let k = 0; k <= 220; k++) {
        const x = c.cx - c.mitad + (2 * c.mitad * k) / 220;
        puntos.push({ s: x, f: F.f(x, g.y) });
      }
      tramos.push({ puntos, color: COLOR.teal, relleno: true });
      if (!sinEnjambre) marcas.push({ s: g.x, f: F.f(g.x, g.y), texto: 'gBest', color: COLOR.salmon });
    }

    if (titulo !== tituloCorte) {
      tituloCorte = titulo;
      $('corte-titulo').textContent = titulo;
    }

    const todos = tramos.flatMap((t) => t.puntos).concat(marcas);
    // El margen es solo visual: las marcas del eje cubren el rango real de los datos,
    // para no mostrar valores de f que no existen (como negativos).
    const datoMin = Math.min(...todos.map((q) => q.f));
    const datoMax = Math.max(...todos.map((q) => q.f));
    const margen = (datoMax - datoMin) * 0.12 || 1e-6;
    const fMin = datoMin - margen;
    const fMax = datoMax + margen;
    const sMin = Math.min(...todos.map((q) => q.s));
    const sMax = Math.max(...todos.map((q) => q.s));
    const X = (s) => m.l + ((s - sMin) / (sMax - sMin || 1)) * (W - m.l - m.r);
    const Y = (f) => m.t + ((fMax - f) / (fMax - fMin)) * (H - m.t - m.b);

    // Ejes.
    cctx.font = '10px "Segoe UI", system-ui, sans-serif';
    cctx.fillStyle = 'rgba(159, 184, 176, 0.9)';
    cctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
    cctx.textAlign = 'right';
    for (let k = 0; k <= 3; k++) {
      const f = datoMin + ((datoMax - datoMin) * k) / 3;
      const y = Y(f);
      cctx.beginPath();
      cctx.moveTo(m.l, y);
      cctx.lineTo(W - m.r, y);
      cctx.stroke();
      cctx.fillText(fmt(f, Math.abs(datoMax) < 10 ? 2 : 1), m.l - 6, y + 3);
    }
    cctx.textAlign = 'center';
    cctx.fillText(recorrido ? 'distancia recorrida' : 'x', (m.l + W - m.r) / 2, H - 6);
    cctx.save();
    cctx.translate(11, (m.t + H - m.b) / 2);
    cctx.rotate(-Math.PI / 2);
    cctx.fillText('f', 0, 0);
    cctx.restore();

    // Curva(s).
    for (const tramo of tramos) {
      cctx.beginPath();
      tramo.puntos.forEach((q, i) => (i ? cctx.lineTo(X(q.s), Y(q.f)) : cctx.moveTo(X(q.s), Y(q.f))));
      cctx.strokeStyle = tramo.color;
      cctx.lineWidth = 2.4;
      cctx.stroke();
      if (tramo.relleno) {
        const ult = tramo.puntos[tramo.puntos.length - 1];
        cctx.lineTo(X(ult.s), H - m.b);
        cctx.lineTo(X(tramo.puntos[0].s), H - m.b);
        cctx.closePath();
        const g = cctx.createLinearGradient(0, m.t, 0, H - m.b);
        g.addColorStop(0, 'rgba(79, 179, 160, 0.28)');
        g.addColorStop(1, 'rgba(79, 179, 160, 0)');
        cctx.fillStyle = g;
        cctx.fill();
      }
    }

    // Marcas con su valor de f, alternando arriba y abajo para que no se encimen.
    marcas.forEach((q, i) => {
      const x = X(q.s);
      const y = Y(q.f);
      cctx.fillStyle = q.color;
      cctx.beginPath();
      cctx.arc(x, y, 5, 0, Math.PI * 2);
      cctx.fill();
      cctx.strokeStyle = 'rgba(1, 8, 11, 0.9)';
      cctx.lineWidth = 1.5;
      cctx.stroke();
      const arriba = i % 2 === 0;
      const ty = arriba ? Math.max(m.t - 4, y - 10) : Math.min(H - m.b - 2, y + 18);
      cctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
      cctx.textAlign = x > W - 60 ? 'right' : x < m.l + 30 ? 'left' : 'center';
      cctx.lineWidth = 3;
      cctx.strokeText(`${q.texto} ${fmt(q.f, 2)}`, x, ty);
      cctx.fillText(`${q.texto} ${fmt(q.f, 2)}`, x, ty);
    });

    if (nota) {
      cctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
      cctx.textAlign = 'right';
      cctx.fillStyle = '#ffffff';
      cctx.fillText(nota, W - m.r, 14);
    }
  }

  // ---------------------------------------------------------------- fórmula con números

  const num = (v) => (v <= -0.005 ? '−' + Math.abs(v).toFixed(2) : Math.abs(v).toFixed(2));
  const par = (v) => (v <= -0.005 ? `(${num(v)})` : num(v));
  const SUSTITUCION = {
    rastrigin: (x, y) => `20 + ${par(x)}² + ${par(y)}² − 10·[cos(2π·${par(x)}) + cos(2π·${par(y)})]`,
    esfera: (x, y) => `${par(x)}² + ${par(y)}²`,
    ackley: (x, y) =>
      `−20·e^(−0.2·√(0.5·(${par(x)}² + ${par(y)}²))) − e^(0.5·[cos(2π·${par(x)}) + cos(2π·${par(y)})]) + e + 20`,
    himmelblau: (x, y) => `(${par(x)}² + ${par(y)} − 11)² + (${par(x)} + ${par(y)}² − 7)²`,
    griewank: (x, y) => `1 + (${par(x)}² + ${par(y)}²)/4000 − cos(${par(x)})·cos(${par(y)}/√2)`,
    picos: (x, y) =>
      `3(1 − ${par(x)})²·e^(−${par(x)}² − (${par(y)} + 1)²) − 10(${par(x)}/5 − ${par(x)}³ − ${par(y)}⁵)·e^(−${par(x)}² − ${par(y)}²) − ⅓·e^(−(${par(x)} + 1)² − ${par(y)}²)`,
  };
  let htmlFormula = '';

  function actualizarFormulaViva() {
    const E = estado.enjambre;
    const F = FUNCIONES[estado.funcion];
    const p = E.particulas[estado.seleccionada];
    let ref;
    let titulo;
    if (estado.verFuerzas && p) {
      // En la cámara lenta la partícula todavía está en su punto de partida.
      ref = estado.progreso < 1 ? p.previo : p;
      titulo = `Valor de f en la partícula #${p.id + 1}`;
    } else {
      ref = E.gBest;
      titulo = 'Valor de f en el gBest';
    }
    let html;
    if (estado.ocultarParticulas) {
      // Capítulo 1: solo la función, todavía sin evaluarla en ninguna partícula.
      titulo = 'La función';
      html = `${F.formula}<br><span class="tenue">Cada punto (x, y) del terreno tiene un valor f.</span>`;
    } else {
      html =
        `<span class="tenue">${F.formula}</span><br>` +
        `f(${num(ref.x)}, ${num(ref.y)}) = ${SUSTITUCION[estado.funcion](ref.x, ref.y)}<br>` +
        `= <b>${fmt(F.f(ref.x, ref.y), 4)}</b>`;
    }
    if (html !== htmlFormula) {
      htmlFormula = html;
      $('formula-viva').innerHTML = html;
      $('formula-titulo').textContent = titulo;
    }
  }

  /** Con la bandada gigante no se dibujan estelas: serían decenas de miles de líneas por cuadro. */
  function conEstelas() {
    return estado.verEstelas && estado.enjambre.n <= 200;
  }

  function actualizarEstelas() {
    const E = estado.enjambre;
    const enReto = estado.modo === 'reto';
    if (enReto && estado.reto.fase !== 'enjambre' && estado.reto.fase !== 'fin') return;
    if (!enReto && !conEstelas()) return;
    E.particulas.forEach((p, i) => {
      const pos = posicionMostrada(p);
      const buf = estado.bufEstelas[i];
      const ultimo = buf[buf.length - 1];
      if (!ultimo || ultimo.x !== pos.x || ultimo.y !== pos.y) {
        buf.push(pos);
        if (buf.length > LARGO_ESTELA) buf.shift();
      } else if (buf.length > 1) {
        buf.shift(); // en reposo la estela se va recogiendo
      }
      if (enReto && estado.reto.fase === 'enjambre') {
        const [sx, sy] = aPantalla(pos.x, pos.y);
        const previo = estado.ultimoRevelado[i];
        if (!previo || Math.hypot(sx - previo[0], sy - previo[1]) > 5) {
          revelar(pos.x, pos.y, 0.03);
          estado.ultimoRevelado[i] = [sx, sy];
        }
      }
    });
  }

  // ---------------------------------------------------------------- dibujo

  function dibujar(ahora) {
    const L = estado.lado;
    ctx.setTransform(estado.dpr, 0, 0, estado.dpr, 0, 0);
    const v = usaMapaGL() ? null : estado.vistaMapa;
    if (usaMapaGL()) {
      // El mapa lo pinta la tarjeta gráfica en el lienzo de abajo: aquí solo se limpia.
      ctx.clearRect(0, 0, L, L);
    } else {
      ctx.fillStyle = '#010608';
      ctx.fillRect(0, 0, L, L);
    }
    if (v) {
      const [x0, y0] = aPantalla(v.cx - v.mitad, v.cy + v.mitad);
      const tam = (v.mitad / estado.camara.mitad) * L;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(mapa, x0, y0, tam, tam);
    }
    dibujarCuadricula();

    const enReto = estado.modo === 'reto';
    if (enReto && estado.nieblaAlfa > 0) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = estado.nieblaAlfa;
      ctx.drawImage(niebla, 0, 0);
      ctx.restore();
    }

    if (estado.verMinimo && (!enReto || estado.reto.fase === 'fin')) dibujarMinimo();
    if (enReto) dibujarIntentos();

    if (estado.resaltarDominio) dibujarDominio(ahora);
    const verEnjambre = (!enReto || estado.reto.fase === 'enjambre' || estado.reto.fase === 'fin') && !estado.ocultarParticulas;
    if (!verEnjambre) return;

    const E = estado.enjambre;
    if (estado.verPBest && !enReto) dibujarPBest(E);
    if (conEstelas() || (enReto && estado.verEstelas)) dibujarEstelas();
    if (estado.camino) dibujarCaminoGBest(E, ahora);
    dibujarParticulas(E, ahora);
    dibujarGBest(ahora);
    dibujarOndas(ahora);
    if (estado.verFuerzas && !enReto) dibujarFuerzas(E);
    if (estado.etiquetasF) dibujarEtiquetasF(E);
    if (estado.destacarInicial >= 0) dibujarInicial(E);
  }

  /** Remate final: el camino que siguió el gBest desde el inicio, dibujado poco a poco. */
  function dibujarCaminoGBest(E, ahora) {
    // Solo los puntos donde el gBest cambió de lugar.
    const pts = [];
    for (const e of E.historial) {
      const u = pts[pts.length - 1];
      if (!u || u.x !== e.x || u.y !== e.y) pts.push(e);
    }
    if (pts.length < 2) return;
    // t0 puede estar un poco en el futuro (se espera a que la cámara retroceda): avance entre 0 y 1.
    const avance = Math.max(0, Math.min(1, (ahora - estado.camino.t0) / 2800)) * (pts.length - 1);
    const enteros = Math.floor(avance);
    const parcial = avance - enteros;

    ctx.save();
    ctx.strokeStyle = COLOR.salmon;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.shadowColor = COLOR.salmon;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    pts.slice(0, enteros + 1).forEach((q, i) => {
      const [sx, sy] = aPantalla(q.x, q.y);
      if (i) ctx.lineTo(sx, sy);
      else ctx.moveTo(sx, sy);
    });
    if (enteros < pts.length - 1) {
      const a = pts[enteros];
      const b = pts[enteros + 1];
      const [sx, sy] = aPantalla(a.x + (b.x - a.x) * parcial, a.y + (b.y - a.y) * parcial);
      ctx.lineTo(sx, sy);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffffff';
    pts.slice(0, enteros + 1).forEach((q) => {
      const [sx, sy] = aPantalla(q.x, q.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    const [ix, iy] = aPantalla(pts[0].x, pts[0].y);
    texto(`inicio · f = ${fmt(pts[0].gBest, 2)}`, ix, iy - 14, '#ffffff', 13, 700, 'center');
  }

  /** Borde iluminado de la zona donde se reparten las partículas al inicio. */
  function dibujarDominio(ahora) {
    const [a, b] = dominio();
    const [x0, y0] = aPantalla(a, b);
    const [x1, y1] = aPantalla(b, a);
    const pulso = 0.55 + 0.45 * Math.sin(ahora / 260);
    ctx.save();
    ctx.strokeStyle = `rgba(242, 139, 127, ${pulso.toFixed(3)})`;
    ctx.lineWidth = 5;
    ctx.shadowColor = COLOR.salmon;
    ctx.shadowBlur = 18;
    ctx.strokeRect(x0 + 3, y0 + 3, x1 - x0 - 6, y1 - y0 - 6);
    ctx.restore();
    texto(`x, y al azar entre ${num(a)} y ${num(b)}`, (x0 + x1) / 2, y0 + 92, COLOR.salmon, 16, 700, 'center');
  }

  /** Una partícula con su posición inicial y su velocidad inicial. */
  function dibujarInicial(E) {
    const p = E.particulas[estado.destacarInicial];
    if (!p) return;
    const pos = posicionMostrada(p);
    const [sx, sy] = aPantalla(pos.x, pos.y);
    ctx.save();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sx, sy, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    flecha(pos.x, pos.y, pos.x + p.vx, pos.y + p.vy, COLOR.azul, 'velocidad inicial', 3);
    // Las coordenadas van debajo para no encimarse con el rótulo de la flecha.
    texto(`(${num(pos.x)}, ${num(pos.y)})`, sx, sy + 32, '#ffffff', 15, 700, 'center');
  }

  function pasoBonito(rango) {
    const bruto = rango / 8;
    const p = Math.pow(10, Math.floor(Math.log10(bruto)));
    const m = bruto / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  }

  function dibujarCuadricula() {
    const c = estado.camara;
    const L = estado.lado;
    const s = pasoBonito(2 * c.mitad);
    const decimales = Math.max(0, -Math.floor(Math.log10(s) + 1e-9));
    ctx.save();
    ctx.lineWidth = 1;
    ctx.font = '11px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(242, 236, 228, 0.45)';
    for (let k = Math.ceil((c.cx - c.mitad) / s); k * s <= c.cx + c.mitad; k++) {
      const x = k * s;
      const [sx] = aPantalla(x, 0);
      ctx.strokeStyle = k === 0 ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, L);
      ctx.stroke();
      ctx.fillText(x.toFixed(decimales), sx + 3, L - 6);
    }
    for (let k = Math.ceil((c.cy - c.mitad) / s); k * s <= c.cy + c.mitad; k++) {
      const y = k * s;
      const [, sy] = aPantalla(0, y);
      ctx.strokeStyle = k === 0 ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.05)';
      ctx.beginPath();
      ctx.moveTo(0, sy);
      ctx.lineTo(L, sy);
      ctx.stroke();
      ctx.fillText(y.toFixed(decimales), 5, sy - 3);
    }
    ctx.restore();
  }

  function texto(cadena, x, y, color, tamano = 12, peso = 600, alinear = 'left') {
    ctx.save();
    ctx.font = `${peso} ${tamano}px "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = alinear;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(1, 8, 11, 0.9)';
    ctx.strokeText(cadena, x, y);
    ctx.fillStyle = color;
    ctx.fillText(cadena, x, y);
    ctx.restore();
  }

  function dibujarMinimo() {
    for (const m of FUNCIONES[estado.funcion].optimos) dibujarUnMinimo(m);
  }

  function dibujarUnMinimo(m) {
    const [sx, sy] = aPantalla(m.x, m.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 8);
    ctx.lineTo(sx + 8, sy);
    ctx.lineTo(sx, sy + 8);
    ctx.lineTo(sx - 8, sy);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
    // La etiqueta solo se muestra si el gBest no está encima, para no amontonar texto.
    const g = gBestMostrado();
    const [gx, gy] = aPantalla(g.x, g.y);
    if (Math.hypot(gx - sx, gy - sy) > 80) texto(palabras().optimo, sx, sy + 24, 'rgba(255, 255, 255, 0.85)', 11, 500, 'center');
  }

  function dibujarIntentos() {
    const intentos = estado.reto.intentos;
    if (!intentos.length) return;
    const mejor = mejorHumano();
    for (const it of intentos) {
      const [sx, sy] = aPantalla(it.x, it.y);
      const esMejor = it === mejor;
      ctx.beginPath();
      ctx.arc(sx, sy, esMejor ? 7 : 5, 0, Math.PI * 2);
      ctx.fillStyle = esMejor ? COLOR.dorado : 'rgba(255, 255, 255, 0.85)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(1, 8, 11, 0.9)';
      ctx.stroke();
      texto(fmt(it.f, 2), sx + 9, sy - 8, esMejor ? COLOR.dorado : '#ffffff', 12, 600);
    }
    const [mx, my] = aPantalla(mejor.x, mejor.y);
    texto('tú', mx, my + 22, COLOR.dorado, 13, 700, 'center');
  }

  function dibujarPBest(E) {
    ctx.save();
    ctx.strokeStyle = 'rgba(126, 224, 181, 0.65)';
    ctx.lineWidth = 1.2;
    for (const p of E.particulas) {
      const [sx, sy] = aPantalla(p.pBest.x, p.pBest.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 3.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function dibujarEstelas() {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.8;
    for (const buf of estado.bufEstelas) {
      for (let k = 1; k < buf.length; k++) {
        const [x0, y0] = aPantalla(buf[k - 1].x, buf[k - 1].y);
        const [x1, y1] = aPantalla(buf[k].x, buf[k].y);
        // Los tramos muy largos (saltos grandes vistos con zoom) se atenúan para no formar una telaraña.
        const largo = Math.hypot(x1 - x0, y1 - y0);
        const alfa = (k / buf.length) * 0.6 * Math.min(1, 45 / Math.max(largo, 1));
        ctx.strokeStyle = `rgba(242, 139, 127, ${alfa.toFixed(3)})`;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function dibujarParticulas(E, ahora) {
    // Con tarjeta gráfica, las partículas ya se pintaron en el lienzo de abajo, con resplandor;
    // aquí solo falta el anillo de la partícula seleccionada.
    if (particulasPorGL()) {
      if (estado.verFuerzas && estado.modo === 'sim') {
        const pos = posicionMostrada(E.particulas[estado.seleccionada]);
        const [sx, sy] = aPantalla(pos.x, pos.y);
        ctx.save();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, sy, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      return;
    }
    const datos = E.particulas.map((p) => {
      const pos = posicionMostrada(p);
      // Al reiniciar, las partículas aparecen una tras otra con un pequeño rebote.
      // Si aparecen despacio (capítulo 2), además caen desde arriba hasta su punto.
      const t = progresoAparicion(p, ahora);
      const [px, py] = aPantalla(pos.x, pos.y);
      const caida = estado.escalonAparicion > 50 ? (1 - suavizar(t)) * 60 : 0;
      return { punto: [px, py - caida], escala: t > 0 ? rebote(t) : 0, alfa: t };
    });
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const d of datos) {
      if (d.alfa <= 0) continue;
      const r = 18 * d.escala;
      ctx.globalAlpha = d.alfa;
      ctx.drawImage(brillo, d.punto[0] - r, d.punto[1] - r, 2 * r, 2 * r);
    }
    ctx.restore();
    ctx.fillStyle = COLOR.nucleo;
    for (const d of datos) {
      if (d.alfa <= 0) continue;
      ctx.beginPath();
      ctx.arc(d.punto[0], d.punto[1], 3 * d.escala, 0, Math.PI * 2);
      ctx.fill();
    }
    if (estado.verFuerzas && estado.modo === 'sim') {
      const [sx, sy] = datos[estado.seleccionada].punto;
      ctx.save();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function dibujarGBest(ahora) {
    const g = gBestMostrado();
    const [sx, sy] = aPantalla(g.x, g.y);
    const pulso = 1 + 0.28 * Math.sin(ahora / 240);
    ctx.save();
    ctx.strokeStyle = COLOR.salmon;
    ctx.lineWidth = 2.2;
    ctx.shadowColor = COLOR.salmon;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(sx, sy, 12 * pulso, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      ctx.moveTo(sx + dx * 7, sy + dy * 7);
      ctx.lineTo(sx + dx * 20, sy + dy * 20);
    }
    ctx.stroke();
    ctx.restore();
    texto('gBest', sx, sy - 24, COLOR.salmon, 12, 700, 'center');
  }

  function dibujarOndas(ahora) {
    estado.ondas = estado.ondas.filter((o) => ahora - o.t0 < 1000);
    ctx.save();
    for (const o of estado.ondas) {
      const t = (ahora - o.t0) / 1000;
      const [sx, sy] = aPantalla(o.x, o.y);
      ctx.strokeStyle = `rgba(242, 139, 127, ${(1 - t).toFixed(3)})`;
      ctx.lineWidth = 4 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.arc(sx, sy, 12 + 80 * (1 - Math.pow(1 - t, 3)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function flecha(x0, y0, x1, y1, color, etiqueta, ancho = 3) {
    const [a0, b0] = aPantalla(x0, y0);
    const [a1, b1] = aPantalla(x1, y1);
    const largo = Math.hypot(a1 - a0, b1 - b0);
    if (largo < 1.5) return;
    const ang = Math.atan2(b1 - b0, a1 - a0);
    const punta = Math.min(13, largo * 0.45);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle = color;
    ctx.lineWidth = ancho;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
    ctx.shadowBlur = 5;
    ctx.beginPath();
    ctx.moveTo(a0, b0);
    ctx.lineTo(a1 - Math.cos(ang) * punta * 0.6, b1 - Math.sin(ang) * punta * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(a1, b1);
    ctx.lineTo(a1 - Math.cos(ang - 0.42) * punta, b1 - Math.sin(ang - 0.42) * punta);
    ctx.lineTo(a1 - Math.cos(ang + 0.42) * punta, b1 - Math.sin(ang + 0.42) * punta);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Solo se rotulan las flechas con tamaño suficiente, para no encimar texto.
    if (etiqueta && largo > 36) {
      const nx = -Math.sin(ang) * 16;
      const ny = Math.cos(ang) * 16;
      texto(etiqueta, (a0 + a1) / 2 + nx, (b0 + b1) / 2 + ny + 4, color, 14, 700, 'center');
    }
  }

  function lineaGuia(x0, y0, x1, y1, color) {
    const [a0, b0] = aPantalla(x0, y0);
    const [a1, b1] = aPantalla(x1, y1);
    ctx.save();
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(a0, b0);
    ctx.lineTo(a1, b1);
    ctx.stroke();
    ctx.restore();
  }

  function dibujarFuerzas(E) {
    const p = E.particulas[estado.seleccionada];
    if (!p || !p.fuerzas) return;
    const F = p.fuerzas;
    const base = p.previo;
    const n = estado.fuerzasPaso;

    if (n >= 2) {
      lineaGuia(base.x, base.y, F.pBest.x, F.pBest.y, COLOR.verde);
      const [px, py] = aPantalla(F.pBest.x, F.pBest.y);
      ctx.save();
      ctx.strokeStyle = COLOR.verde;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      texto('pBest', px, py - 12, COLOR.verde, 13, 700, 'center');
    }
    if (n >= 3) lineaGuia(base.x, base.y, F.gBest.x, F.gBest.y, COLOR.salmon);

    // Las tres componentes encadenadas, punta con cola: así se ve la suma vectorial.
    let cx = base.x;
    let cy = base.y;
    [
      [F.inercia, COLOR.azul, 'inercia'],
      [F.cognitiva, COLOR.verde, 'cognitiva'],
      [F.social, COLOR.salmon, 'social'],
    ].forEach(([vector, color, nombre], i) => {
      if (i < n) flecha(cx, cy, cx + vector.x, cy + vector.y, color, nombre);
      cx += vector.x;
      cy += vector.y;
    });

    if (n >= 4) {
      flecha(base.x, base.y, p.x, p.y, '#ffffff', 'salto', 3.6);
      if (F.limitada) {
        const [tx, ty] = aPantalla(p.x, p.y);
        texto('velocidad limitada a vmax', tx + 14, ty + 20, '#ffffff', 12, 500);
      }
    }
  }

  function dibujarEtiquetasF(E) {
    for (const p of E.particulas) {
      const pos = posicionMostrada(p);
      const [sx, sy] = aPantalla(pos.x, pos.y);
      texto(fmt(p.f, 1), sx, sy - 12, '#ffffff', 12, 600, 'center');
    }
  }

  // ---------------------------------------------------------------- gráfica de convergencia

  function etiquetaPotencia(k) {
    const v = Math.pow(10, k);
    if (k >= 0) return String(v);
    if (k >= -3) return v.toFixed(-k);
    return '1e' + k;
  }

  function dibujarGrafica() {
    const E = estado.enjambre;
    if (!E) return;
    const r = tamanoDe(grafica); // tamaño anotado: medir aquí obligaría a recalcular el diseño
    if (!r.width) return;
    const dpr = densidad();
    if (grafica.width !== Math.round(r.width * dpr) || grafica.height !== Math.round(r.height * dpr)) {
      grafica.width = Math.round(r.width * dpr);
      grafica.height = Math.round(r.height * dpr);
    }
    const W = r.width;
    const H = r.height;
    const m = { l: 40, r: 58, t: 14, b: 22 };
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    gctx.clearRect(0, 0, W, H);
    if (estado.ocultarParticulas) return; // capítulo 1: todavía no hay enjambre que graficar
    // En el reto no se muestra nada hasta soltar el enjambre, para no dar pistas.
    if (estado.modo === 'reto' && (estado.reto.fase === 'humano' || estado.reto.fase === 'listo')) return;

    const h = E.historial;
    // Se grafica la distancia al óptimo |f − f*|: sirve igual para mínimos y para máximos.
    const fOptimo = FUNCIONES[estado.funcion].optimo.f;
    const distancia = (v) => Math.abs(v - fOptimo);
    const lg = (v) => Math.log10(Math.max(distancia(v), 1e-8));
    const alto = Math.ceil(Math.max(...h.map((e) => lg(e.promedio))));
    let bajo = Math.max(-8, Math.floor(Math.min(...h.map((e) => lg(e.gBest)))));
    if (alto - bajo < 2) bajo = alto - 2;
    const X = (i) => m.l + (i / E.maxIter) * (W - m.l - m.r);
    const Y = (v) => m.t + ((alto - lg(v)) / (alto - bajo)) * (H - m.t - m.b);

    // Ejes y referencias.
    gctx.font = '10px "Segoe UI", system-ui, sans-serif';
    gctx.fillStyle = 'rgba(159, 184, 176, 0.9)';
    gctx.textAlign = 'right';
    const paso = Math.max(1, Math.ceil((alto - bajo) / 5));
    for (let k = bajo; k <= alto; k += paso) {
      const y = m.t + ((alto - k) / (alto - bajo)) * (H - m.t - m.b);
      gctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      gctx.beginPath();
      gctx.moveTo(m.l, y);
      gctx.lineTo(W - m.r, y);
      gctx.stroke();
      gctx.fillText(etiquetaPotencia(k), m.l - 6, y + 3);
    }
    gctx.textAlign = 'center';
    for (let i = 0; i <= E.maxIter; i += E.maxIter / 4) gctx.fillText(String(i), X(i), H - 6);

    // Cursor de la iteración actual.
    gctx.save();
    gctx.setLineDash([3, 4]);
    gctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    gctx.beginPath();
    gctx.moveTo(X(E.iteracion), m.t);
    gctx.lineTo(X(E.iteracion), H - m.b);
    gctx.stroke();
    gctx.restore();

    // Promedio del enjambre (punteado).
    gctx.save();
    gctx.setLineDash([4, 3]);
    gctx.strokeStyle = 'rgba(79, 179, 160, 0.9)';
    gctx.lineWidth = 1.4;
    gctx.beginPath();
    h.forEach((e, i) => (i ? gctx.lineTo(X(e.iteracion), Y(e.promedio)) : gctx.moveTo(X(e.iteracion), Y(e.promedio))));
    gctx.stroke();
    gctx.restore();

    // gBest en escalones: solo baja cuando alguien encuentra algo mejor.
    gctx.beginPath();
    h.forEach((e, i) => {
      if (i === 0) gctx.moveTo(X(e.iteracion), Y(e.gBest));
      else {
        gctx.lineTo(X(e.iteracion), Y(h[i - 1].gBest));
        gctx.lineTo(X(e.iteracion), Y(e.gBest));
      }
    });
    const ultimo = h[h.length - 1];
    gctx.save();
    gctx.strokeStyle = COLOR.salmon;
    gctx.lineWidth = 2.4;
    gctx.shadowColor = COLOR.salmon;
    gctx.shadowBlur = 8;
    gctx.stroke();
    gctx.restore();
    gctx.lineTo(X(ultimo.iteracion), H - m.b);
    gctx.lineTo(X(0), H - m.b);
    gctx.closePath();
    const relleno = gctx.createLinearGradient(0, m.t, 0, H - m.b);
    relleno.addColorStop(0, 'rgba(242, 139, 127, 0.3)');
    relleno.addColorStop(1, 'rgba(242, 139, 127, 0)');
    gctx.fillStyle = relleno;
    gctx.fill();

    // Puntos donde hubo mejoras grandes (más de 20 %).
    gctx.fillStyle = '#ffffff';
    for (let i = 1; i < h.length; i++) {
      if (distancia(h[i].gBest) < distancia(h[i - 1].gBest) * 0.8) {
        gctx.beginPath();
        gctx.arc(X(h[i].iteracion), Y(h[i].gBest), 2.6, 0, Math.PI * 2);
        gctx.fill();
      }
    }

    // Valor actual destacado.
    const ux = X(ultimo.iteracion);
    const uy = Y(ultimo.gBest);
    gctx.fillStyle = COLOR.salmon;
    gctx.beginPath();
    gctx.arc(ux, uy, 4.5, 0, Math.PI * 2);
    gctx.fill();
    gctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    gctx.textAlign = 'left';
    gctx.fillText(fmt(distancia(ultimo.gBest), 3), Math.min(ux + 8, W - m.r + 4), Math.max(m.t + 8, uy - 6));
  }

  // ---------------------------------------------------------------- panel y marcadores

  function actualizarPanel() {
    const E = estado.enjambre;
    const g = E.gBest;
    const enReto = estado.modo === 'reto';
    // Se ocultan los datos en el reto (no revelar la respuesta) y mientras el terreno
    // se presenta vacío en el capítulo 1 (todavía no hay enjambre).
    const sinEnjambre = estado.ocultarParticulas;
    const ocultarDatos = sinEnjambre || (enReto && (estado.reto.fase === 'humano' || estado.reto.fase === 'listo'));
    const vacio = sinEnjambre ? '—' : '?';

    escribir('est-iter', `${E.iteracion} / ${E.maxIter}`);
    escribir('est-gbest', ocultarDatos ? vacio : fmt(g.f));
    escribir('est-pos', ocultarDatos ? vacio : `(${g.x.toFixed(3)}, ${g.y.toFixed(3)})`);
    escribir('est-evals', sinEnjambre ? '—' : E.evaluaciones.toLocaleString('es-CO'));
    $('barra').style.transform = `scaleX(${E.iteracion / E.maxIter})`; // escalar no recalcula el diseño

    escribir('hud-iter', `<span>ITERACIÓN</span><b>${E.iteracion}</b><small>/ ${E.maxIter}</small>`, true);
    escribir('hud-gbest', `<span>MEJOR f</span><b>${ocultarDatos ? vacio : valorAmigable(g.f)}</b>`, true);

    const play = $('btn-play');
    escribir('btn-play', estado.reproduciendo ? '❚❚ Pausar' : E.iteracion > 0 ? '▶ Continuar' : '▶ Iniciar');
    play.disabled = E.terminado || (enReto && estado.reto.fase !== 'enjambre');
    $('btn-paso').disabled = E.terminado || enReto;

    const info = $('info-particula');
    const p = E.particulas[estado.seleccionada];
    if (estado.verFuerzas && !enReto && p) {
      info.classList.remove('oculto');
      $('particula-titulo').textContent = `Partícula #${p.id + 1} · f = ${fmt(p.f, 3)}`;
      const norma = (v) => Math.hypot(v.x, v.y).toFixed(3);
      const F = p.fuerzas;
      $('fz-inercia').textContent = F ? norma(F.inercia) : '—';
      $('fz-cognitiva').textContent = F ? norma(F.cognitiva) : '—';
      $('fz-social').textContent = F ? norma(F.social) : '—';
      $('fz-salto').textContent = F ? Math.hypot(p.x - p.previo.x, p.y - p.previo.y).toFixed(3) : '—';
    } else {
      info.classList.add('oculto');
    }

    if (enReto) {
      const h = mejorHumano();
      $('reto-intentos').textContent = `${estado.reto.intentos.length} / ${INTENTOS_RETO}`;
      $('reto-mejor').textContent = h ? fmt(h.f) : '—';
    }
  }

  let textoZoom = '';
  function actualizarZoom() {
    const [a, b] = dominio();
    const z = (b - a) / 2 / estado.camara.mitad;
    const manual = estado.modoCam === 'manual' && estado.modo !== 'reto';
    const nuevo =
      z > 1.15 || manual
        ? `zoom ×${z < 10 ? z.toFixed(1) : Math.round(z)}` + (manual ? ' · manual (doble clic: automático)' : '')
        : '';
    if (nuevo !== textoZoom) {
      textoZoom = nuevo;
      $('hud-zoom').textContent = nuevo;
    }
  }

  function sincronizarControles() {
    $('r-w').value = estado.w;
    $('r-c1').value = estado.c1;
    $('r-c2').value = estado.c2;
    $('r-n').value = estado.n;
    $('v-w').textContent = estado.w.toFixed(2);
    $('v-c1').textContent = estado.c1.toFixed(1);
    $('v-c2').textContent = estado.c2.toFixed(1);
    $('v-n').textContent = estado.n;
    $('in-semilla').value = estado.semilla;
    $('chk-decaimiento').checked = estado.decaimiento;
    $('chk-fuerzas').checked = estado.verFuerzas;
    $('chk-camara').checked = estado.camAuto;
    document.querySelectorAll('[data-escenario]').forEach((b) => {
      b.classList.toggle('activo', b.dataset.escenario === estado.escenario);
    });
  }

  function detectarEscenario() {
    estado.escenario = null;
    if (estado.decaimiento) return;
    for (const [clave, e] of Object.entries(ESCENARIOS)) {
      if (Math.abs(e.w - estado.w) < 1e-9 && Math.abs(e.c1 - estado.c1) < 1e-9 && Math.abs(e.c2 - estado.c2) < 1e-9) {
        estado.escenario = clave;
      }
    }
  }

  // ---------------------------------------------------------------- avisos

  function mostrarAviso(titulo, html, boton) {
    $('aviso-titulo').textContent = titulo;
    $('aviso-texto').innerHTML = html;
    const b = $('aviso-boton');
    if (boton) {
      b.textContent = boton.texto;
      b.onclick = boton.accion;
      b.classList.remove('oculto');
    } else {
      b.classList.add('oculto');
    }
    $('aviso').classList.remove('oculto');
  }

  function ocultarAviso() {
    $('aviso').classList.add('oculto');
  }

  // ---------------------------------------------------------------- modos

  function mejorHumano() {
    let mejor = null;
    for (const it of estado.reto.intentos) if (!mejor || esMejor(it.f, mejor.f)) mejor = it;
    return mejor;
  }

  function nuevaSemilla() {
    estado.semilla = 1 + Math.floor(Math.random() * 99999);
    $('in-semilla').value = estado.semilla;
  }

  function marcarModo(id) {
    for (const b of ['btn-modo-sim', 'btn-modo-reto', 'btn-historia']) $(b).classList.toggle('activo', b === id);
  }

  function iniciarSimulacion() {
    estado.modo = 'sim';
    estado.modoCam = 'auto';
    estado.nieblaAlfa = 0;
    ocultarAviso();
    document.body.classList.remove('reto');
    ajustarTamano(); // vuelve a aparecer la columna 3D
    marcarModo('btn-modo-sim');
    reiniciar();
  }

  function iniciarReto() {
    // El reto es con un enjambre normal: con miles de partículas, revelar la niebla sería muy pesado.
    if (estado.n > 100) {
      estado.n = estado.nAnterior || 30;
      $('r-n').value = estado.n;
      $('v-n').textContent = estado.n;
      $('btn-bandada').classList.remove('activo');
      $('btn-bandada').textContent = 'Bandada gigante: 2.000 partículas';
    }
    estado.modo = 'reto';
    estado.reto = { fase: 'humano', intentos: [] };
    estado.revelados = [];
    estado.nieblaAlfa = 1;
    estado.camara = vistaCompleta(); // la niebla se dibuja con la vista completa
    estado.vistaMapa = null;
    document.body.classList.add('reto');
    ajustarTamano(); // en el reto se oculta la vista 3D, porque revelaría el terreno
    marcarModo('btn-modo-reto');
    reiniciar();
    redibujarNiebla();
    mostrarAviso(
      `¿Dónde está el punto ${palabras().extremo}?`,
      `El terreno está oculto. Tienes <b>${INTENTOS_RETO} intentos</b>: haz clic sobre el mapa y cada clic ilumina un poco el terreno.`
    );
    actualizarPanel();
  }

  function soltarEnjambre() {
    ocultarAviso();
    Sonido.barrido(true);
    estado.reto.fase = 'enjambre';
    estado.reproduciendo = true;
    actualizarPanel();
  }

  function clicEnMapa(ev) {
    // Si el usuario venía arrastrando el mapa, soltar el botón no cuenta como clic.
    if (huboArrastreMapa) {
      huboArrastreMapa = false;
      return;
    }
    const r = lienzo.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;

    if (estado.modo === 'reto') {
      if (estado.reto.fase !== 'humano') return;
      ocultarAviso();
      const [x, y] = aDominio(px, py);
      estado.reto.intentos.push({ x, y, f: FUNCIONES[estado.funcion].f(x, y) });
      revelar(x, y, 0.075);
      Sonido.gota();
      if (estado.reto.intentos.length >= INTENTOS_RETO) {
        estado.reto.fase = 'listo';
        mostrarAviso(
          'Ahora le toca al enjambre',
          `Tu mejor resultado fue f = <b>${fmt(mejorHumano().f)}</b>.<br>Veamos qué encuentran ${estado.n} partículas que comparten información.`,
          { texto: 'Soltar el enjambre', accion: soltarEnjambre }
        );
      }
      actualizarPanel();
      return;
    }

    // En simulación: clic sobre una partícula para ver sus fuerzas.
    let mejor = -1;
    let distancia = Infinity;
    estado.enjambre.particulas.forEach((p, i) => {
      const pos = posicionMostrada(p);
      const [sx, sy] = aPantalla(pos.x, pos.y);
      const d = Math.hypot(sx - px, sy - py);
      if (d < distancia) {
        distancia = d;
        mejor = i;
      }
    });
    if (distancia < 30) {
      estado.seleccionada = mejor;
      estado.verFuerzas = true;
      $('chk-fuerzas').checked = true;
      actualizarPanel();
    }
  }

  function aplicarEscenario(clave) {
    const e = ESCENARIOS[clave];
    if (estado.modo !== 'sim') iniciarSimulacion();
    estado.w = e.w;
    estado.c1 = e.c1;
    estado.c2 = e.c2;
    estado.decaimiento = false;
    estado.escenario = clave;
    sincronizarControles();
    reiniciar();
    estado.reproduciendo = true;
    Sonido.barrido(true);
    subtitulo(`Escenario ${clave}: <b>${e.nombre}</b> · w = ${e.w}, c₁ = ${e.c1}, c₂ = ${e.c2}`, 3000);
    actualizarPanel();
  }

  function pantallaCompleta() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  }

  // ---------------------------------------------------------------- explicación narrada

  let historiaId = 0;

  function esperar(ms, id) {
    return new Promise((resolver, rechazar) => {
      setTimeout(() => (id === historiaId ? resolver() : rechazar(CANCELADO)), ms);
    });
  }

  function esperarQue(condicion, id) {
    return new Promise((resolver, rechazar) => {
      const t = setInterval(() => {
        if (id !== historiaId) {
          clearInterval(t);
          rechazar(CANCELADO);
        } else if (condicion()) {
          clearInterval(t);
          resolver();
        }
      }, 50);
    });
  }

  function cancelarHistoria() {
    if (!estado.historia) return;
    historiaId++;
    estado.historia = false;
    restaurarEscena();
    Sonido.callar();
    marcarModo('btn-modo-sim');
    marcarCapitulo(-1);
    ocultarCapitulo();
    ocultarSubtitulo();
    actualizarPanel();
  }

  /** Deshace lo que la narración cambia temporalmente (cámara lenta, etiquetas, velocidad...). */
  function restaurarEscena() {
    estado.congelado = false;
    estado.fuerzasPaso = 4;
    estado.etiquetasF = false;
    estado.resaltarDominio = false;
    estado.destacarInicial = -1;
    estado.modoCam = 'auto';
    estado.iterPorSegundo = parseInt($('r-vel').value, 10);
    Sonido.lento(false);
    mostrar3DGrande(false);
  }

  function minusculaInicial(texto) {
    return texto.charAt(0).toLowerCase() + texto.slice(1);
  }

  /** Número para la voz: coma decimal y sin decimales innecesarios. */
  function numeroHablado(v) {
    if (Math.abs(v) < 0.05) return 'casi cero';
    if (v < 0) return 'menos ' + numeroHablado(-v);
    if (v >= 100) return String(Math.round(v));
    const texto = v.toFixed(1).replace('.', ',');
    return texto.endsWith(',0') ? texto.slice(0, -2) : texto;
  }

  /** Coordenada para la voz (sin "casi cero", que suena raro en un punto). */
  function coordenadaHablada(v) {
    return Math.abs(v) < 0.05 ? 'cero' : numeroHablado(v);
  }

  /** Elige una partícula donde las tres fuerzas se vean bien. */
  function elegirParticulaDidactica(E) {
    let mejor = 0;
    let puntaje = -1;
    E.particulas.forEach((p, i) => {
      const F = p.fuerzas;
      if (!F) return;
      const norma = (v) => Math.hypot(v.x, v.y);
      const s = Math.min(norma(F.inercia), norma(F.cognitiva), norma(F.social)) * (F.limitada ? 0.3 : 1);
      if (s > puntaje) {
        puntaje = s;
        mejor = i;
      }
    });
    return mejor;
  }

  /** Para mostrar la posición inicial: una partícula lejos de los bordes y con velocidad visible. */
  function elegirParticulaInicial(E) {
    const [a, b] = dominio();
    const centro = (a + b) / 2;
    const margen = (b - a) * 0.3;
    let mejor = 0;
    let rapidez = -1;
    E.particulas.forEach((p, i) => {
      const lejosDelBorde = Math.abs(p.x - centro) < margen && Math.abs(p.y - centro) < margen;
      const v = Math.hypot(p.vx, p.vy) * (lejosDelBorde ? 1 : 0.2);
      if (v > rapidez) {
        rapidez = v;
        mejor = i;
      }
    });
    return mejor;
  }

  // ---------------------------------------------------------------- modo cine y resumen

  /** Durante la narración se ocultan los controles para que el mapa y el 3D ocupen la pantalla. */
  function modoCine(activo) {
    if (activo && !$('chk-cine').checked) return;
    if (document.body.classList.contains('cine') === activo) return;
    document.body.classList.toggle('cine', activo);
    ajustarTamano();
  }

  const SUPER = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

  /** Valor de f fácil de leer: los números diminutos se muestran como "≈ 0 (1.1 × 10⁻¹¹)". */
  function valorAmigable(v) {
    if (v === 0 || Math.abs(v) >= 1e-4) return fmt(v, 4);
    const exp = Math.floor(Math.log10(Math.abs(v)));
    const mantisa = (v / Math.pow(10, exp)).toFixed(1);
    const potencia = String(exp).split('').map((c) => SUPER[c]).join('');
    return `≈ 0 <small>(${mantisa} × 10${potencia})</small>`;
  }

  /** "f = 12.3" o "f ≈ 0 (…)", según el tamaño del valor. */
  function fAmigable(v) {
    const texto = valorAmigable(v);
    return texto.startsWith('≈') ? `f ${texto}` : `f = ${texto}`;
  }

  function mostrarResumen(llego) {
    const E = estado.enjambre;
    const F = FUNCIONES[estado.funcion];
    const g = E.gBest;
    const cual = F.optimos.length > 1 ? `uno de los ${palabras().optimos}` : `el ${palabras().optimo}`;
    $('resumen').innerHTML =
      '<h4>Resultado</h4><dl>' +
      `<dt>Función</dt><dd>${F.nombre}</dd>` +
      `<dt>Partículas</dt><dd>${E.n}</dd>` +
      `<dt>Iteraciones</dt><dd>${E.iteracion}</dd>` +
      `<dt>Evaluaciones de f</dt><dd>${E.evaluaciones.toLocaleString('es-CO')}</dd>` +
      `<dt>Mejor f</dt><dd class="sin-corte">${valorAmigable(g.f)}</dd>` +
      `<dt>En el punto</dt><dd class="sin-corte">(${num(g.x)}, ${num(g.y)})</dd>` +
      '</dl>' +
      `<p class="veredicto" style="color:${llego ? COLOR.verde : COLOR.salmon}">` +
      (llego ? `Encontró ${cual}` : `Quedó en un ${maximizando() ? 'máximo' : 'mínimo'} local`) +
      '</p>';
    $('resumen').classList.add('visible');
  }

  // ---------------------------------------------------------------- capítulos

  const CAPITULOS = [
    { titulo: 'El terreno', ejecutar: capituloTerreno },
    { titulo: 'Dónde empiezan', ejecutar: capituloInicio },
    { titulo: 'Las fuerzas', ejecutar: capituloFuerzas },
    { titulo: 'Todas a la vez', ejecutar: capituloResultado },
  ];

  function marcarCapitulo(k) {
    document.querySelectorAll('[data-capitulo]').forEach((b) => {
      b.classList.toggle('activo', Number(b.dataset.capitulo) === k);
    });
  }

  function mostrarCapitulo(k, terminado) {
    const el = $('hud-capitulo');
    const siguiente = k + 1 < CAPITULOS.length ? 'Av Pág: siguiente capítulo' : 'Av Pág: volver a empezar';
    el.innerHTML =
      `<span>CAPÍTULO ${k + 1} DE ${CAPITULOS.length}</span><b>${CAPITULOS[k].titulo}</b>` +
      (terminado ? `<small>${siguiente}</small>` : '');
    el.classList.add('visible');
  }

  function ocultarCapitulo() {
    $('hud-capitulo').classList.remove('visible');
  }

  /** H: toda la explicación de corrido. */
  function iniciarHistoria() {
    reproducirCapitulos(0, CAPITULOS.length - 1);
  }

  /** Av Pág / botones: un solo capítulo, y se queda esperando el siguiente. */
  function irACapitulo(k) {
    reproducirCapitulos(Math.max(0, Math.min(CAPITULOS.length - 1, k)), null);
  }

  function siguienteCapitulo() {
    irACapitulo(estado.capitulo + 1 >= CAPITULOS.length ? 0 : estado.capitulo + 1);
  }

  function capituloAnterior() {
    irACapitulo(Math.max(0, estado.capitulo - 1));
  }

  function crearNarrador(id) {
    const pausa = (ms) => esperar(ms, id);
    const hasta = (cond) => esperarQue(cond, id);
    /**
     * Muestra el subtítulo y lo lee en voz alta. Si hay voz, la escena dura lo que
     * tarde en hablar (más una pausa corta); si no, dura el tiempo indicado.
     */
    const narrar = async (html, voz, minimo) => {
      subtitulo(html, 0);
      const inicio = performance.now();
      const hablo = await Sonido.decir(voz);
      if (id !== historiaId) throw CANCELADO;
      const restante = (hablo ? minimo * 0.6 : minimo) - (performance.now() - inicio);
      await pausa(Math.max(hablo ? 350 : 0, restante));
    };
    return { pausa, hasta, narrar };
  }

  async function reproducirCapitulos(desde, hastaCapitulo) {
    cancelarHistoria();
    const id = ++historiaId;
    const narrador = crearNarrador(id);
    const deCorrido = hastaCapitulo !== null;
    const ultimo = deCorrido ? hastaCapitulo : desde;

    estado.historia = true;
    estado.modo = 'sim';
    estado.nieblaAlfa = 0;
    ocultarAviso();
    document.body.classList.remove('reto');
    modoCine(true);
    ajustarTamano();
    marcarModo('btn-historia');

    try {
      revisarVozDeEdge();
      for (let k = desde; k <= ultimo; k++) {
        estado.capitulo = k;
        marcarCapitulo(k);
        mostrarCapitulo(k, false);
        await CAPITULOS[k].ejecutar(narrador);
      }
      // Terminó: la escena queda como está, para que el expositor pueda hablar sobre ella.
      estado.historia = false;
      estado.congelado = false;
      estado.iterPorSegundo = parseInt($('r-vel').value, 10);
      Sonido.lento(false);
      mostrar3DGrande(false);
      marcarModo('btn-modo-sim');
      if (deCorrido) {
        marcarCapitulo(-1);
        ocultarCapitulo();
      } else {
        mostrarCapitulo(ultimo, true);
      }
    } catch (err) {
      if (err !== CANCELADO) throw err;
    }
  }

  // Capítulo 1: el terreno, todavía sin partículas.
  async function capituloTerreno({ narrar }) {
    // Configuración del experimento de la diapositiva: 30 partículas, w = 0.7, c₁ = c₂ = 1.5.
    prepararFuncion(); // usa la función que esté elegida en el panel
    Object.assign(estado, { ...ESCENARIOS.B, decaimiento: false, escenario: 'B', semilla: 7, n: 30 });
    estado.verFuerzas = false;
    estado.fuerzasPaso = 4;
    estado.modoCam = 'completa';
    sincronizarControles();
    reiniciar();
    estado.ocultarParticulas = true; // el terreno se presenta vacío
    actualizarPanel(); // sin enjambre: se ocultan el mejor f, el gBest y la gráfica
    dibujarGrafica();
    Sonido.intensidad(0);
    Sonido.lento(false);

    const funcion = FUNCIONES[estado.funcion];
    const pal = palabras();
    const nombreHablado = funcion.nombre.replace(/\s*\(.*\)$/, '');

    await narrar(
      `Imagina <b>${estado.n} aves</b> buscando el punto ${pal.extremo} de este terreno. Ninguna sabe dónde está.`,
      `Imagina ${estado.n} aves buscando el punto ${pal.extremo} de este terreno. Ninguna sabe dónde está.`,
      4500
    );

    // El terreno en 3D, grande, mientras se presenta la función.
    mostrar3DGrande(true);
    await narrar(
      `Este es el terreno: la función <b>${funcion.nombre}</b>.<br>${funcion.descripcion}`,
      `Este es el terreno: la función ${nombreHablado}. ${funcion.descripcion}`,
      6000
    );
    mostrar3DGrande(false);

    // La regla se dice una sola vez.
    await narrar(
      `En el mapa, las zonas <b>${pal.zonas}</b> son las mejores.<br><b>Mientras ${pal.extremo} el valor de f, mejor.</b>`,
      `En el mapa, las zonas ${pal.zonas} son las mejores. La regla es simple: mientras ${pal.extremo} el valor de la función, mejor.`,
      5000
    );
    if (lateralVisible()) {
      await narrar(
        'A la derecha está el mismo terreno <b>en 3D</b>: la altura es el valor de f.',
        'A la derecha está el mismo terreno en tres dimensiones.',
        3500
      );
    }
  }

  // Capítulo 2: dónde empiezan las partículas.
  async function capituloInicio({ narrar }) {
    estado.modoCam = 'completa';
    estado.verFuerzas = false;
    reiniciar(); // posiciones nuevas al azar, con la semilla actual
    const E = estado.enjambre;
    const [a, b] = dominio();

    // Caen una por una, con una gota de sonido cada una.
    estado.escalonAparicion = 110;
    estado.tInicio = performance.now();
    estado.resaltarDominio = true;
    Sonido.lluvia(E.n, estado.escalonAparicion);
    await narrar(
      `¿Dónde empiezan? <b>Al azar.</b><br>Cada una recibe x e y al azar entre ${num(a)} y ${num(b)}, sin favorecer ninguna zona.`,
      '¿Dónde empiezan? Al azar: cada partícula cae en un punto cualquiera del terreno, sin favorecer ninguna zona.',
      5000
    );
    estado.resaltarDominio = false;

    const k = elegirParticulaInicial(E);
    const p = E.particulas[k];
    estado.destacarInicial = k;
    await narrar(
      `Esta, por ejemplo, empezó en <b>(${num(p.x)}, ${num(p.y)})</b>,<br>con una velocidad inicial pequeña, también al azar.`,
      `Esta, por ejemplo, empezó en el punto ${coordenadaHablada(p.x)}, ${coordenadaHablada(p.y)}, con una velocidad pequeña, también al azar.`,
      5000
    );
    await narrar(
      `El azar sale de una <b>semilla</b> (${estado.semilla}): con la misma semilla, se repite la misma corrida.`,
      'El azar sale de una semilla: con la misma semilla se repite la misma corrida, y así podemos comparar escenarios en igualdad de condiciones.',
      4500
    );
    estado.destacarInicial = -1;

    estado.etiquetasF = true;
    Sonido.aparicion();
    await narrar(
      'Luego cada partícula mide qué tan buena es su posición: calcula <b>f(x, y)</b>.',
      'Luego cada partícula mide qué tan buena es su posición.',
      4500
    );
    estado.etiquetasF = false;

    const pal = palabras();
    estado.ondas.push({ x: E.gBest.x, y: E.gBest.y, t0: performance.now() });
    Sonido.mejora(4);
    await narrar(
      `La de valor ${pal.extremo} se convierte en el <b>gBest</b> (f = ${fmt(E.gBest.f, 2)}), y todas se enteran.`,
      `La de valor ${pal.extremo} se convierte en el mejor global, y todas se enteran.`,
      4500
    );
  }

  // Capítulo 3: las tres fuerzas, en cámara lenta sobre una partícula.
  async function capituloFuerzas({ narrar, pausa, hasta }) {
    if (estado.enjambre.terminado || estado.enjambre.iteracion > 20) reiniciar();
    estado.ocultarParticulas = false;
    estado.etiquetasF = false;
    estado.destacarInicial = -1;
    estado.verFuerzas = false;
    estado.modoCam = 'completa';
    const funcion = FUNCIONES[estado.funcion];

    const objetivo = estado.enjambre.iteracion + 2;
    estado.iterPorSegundo = 1.2;
    estado.reproduciendo = true;
    Sonido.intensidad(0.2);
    // Se mueven mientras habla, pero se detienen justo al llegar a la iteración prevista.
    const frase = narrar(
      'Ahora se mueven. Miremos las primeras iteraciones despacio.',
      'Ahora se mueven. Miremos las primeras iteraciones despacio.',
      1500
    );
    frase.catch(() => {}); // si se cancela, el error lo maneja el await de abajo
    await hasta(() => estado.enjambre.iteracion >= objetivo);
    estado.reproduciendo = false;
    await frase;
    await hasta(() => estado.progreso >= 1);

    avanzar();
    estado.congelado = true;
    estado.progreso = 0;
    estado.seleccionada = elegirParticulaDidactica(estado.enjambre);
    estado.verFuerzas = true;
    estado.fuerzasPaso = 0;
    estado.modoCam = 'particula';
    actualizarPanel();
    Sonido.lento(true);
    Sonido.barrido(false);

    // Valor de f en cada punto de la suma: así se ve dónde caería con cada fuerza.
    // La voz solo dice el número; el subtítulo lo pinta en verde si mejora y en salmón si empeora.
    const elegida = estado.enjambre.particulas[estado.seleccionada];
    const fCadena = puntosCadena(elegida).map((q) => funcion.f(q.x, q.y));
    const fAntes = elegida.fuerzas.fAntes;
    const valorF = (v) => `f = <b style="color:${esMejor(v, fAntes) ? COLOR.verde : COLOR.salmon}">${fmt(v, 2)}</b>`;

    await narrar(
      `Sigamos a <b>una sola partícula</b>. ¿Cómo decide hacia dónde moverse?<br><small>Ahora está en f = ${fmt(fAntes, 2)}</small>`,
      `Sigamos a una sola partícula. Ahora está donde f vale ${numeroHablado(fAntes)}. ¿Cómo decide hacia dónde moverse?`,
      4500
    );
    estado.fuerzasPaso = 1;
    Sonido.toque(5);
    await narrar(
      `<b style="color:#7cc4ff">Inercia:</b> quiere seguir en la dirección en la que venía.<br><small>Con solo la inercia: ${valorF(fCadena[1])}</small>`,
      `Inercia: quiere seguir en la dirección en la que venía. Con solo la inercia, caería en ${numeroHablado(fCadena[1])}.`,
      5000
    );
    estado.fuerzasPaso = 2;
    Sonido.toque(7);
    await narrar(
      `<b style="color:#7ee0b5">Cognitiva:</b> la jala hacia el mejor lugar que <i>ella misma</i> ha visto, su pBest.<br><small>Sumando la cognitiva: ${valorF(fCadena[2])}</small>`,
      `Componente cognitiva: la jala hacia el mejor lugar que ella misma ha visto. Sumándola: ${numeroHablado(fCadena[2])}.`,
      5200
    );
    estado.fuerzasPaso = 3;
    Sonido.toque(9);
    await narrar(
      `<b>Social:</b> la jala hacia el mejor lugar que encontró <i>el grupo</i>, el gBest.<br><small>Y con la social: ${valorF(fCadena[3])}</small>`,
      `Componente social: la jala hacia el mejor lugar que encontró el grupo. Con ella: ${numeroHablado(fCadena[3])}.`,
      5200
    );
    estado.fuerzasPaso = 4;
    Sonido.toque(11);
    // Solo aquí se compara en voz alta.
    const mejoro = esMejor(elegida.f, fAntes);
    await narrar(
      `Al sumar las tres flechas sale su <b style="color:#fff">nuevo salto</b>: f pasa de ${fmt(fAntes, 2)} a ${fmt(elegida.f, 2)}.<br>` +
        (mejoro ? `<b style="color:${COLOR.verde}">Mejoró</b>` : '<b>Esta vez empeoró</b>'),
      `Al sumar las tres flechas sale su nuevo salto: pasa de ${numeroHablado(fAntes)} a ${numeroHablado(elegida.f)}. ` +
        (mejoro ? 'Mejoró.' : 'Esta vez empeoró: no siempre se mejora en un solo paso.'),
      4200
    );
    estado.iterPorSegundo = 0.35;
    estado.congelado = false;
    await hasta(() => estado.progreso >= 1);
    await pausa(900);
    Sonido.lento(false);
  }

  // Capítulo 4: todas a la vez, acelerando hasta el resultado.
  async function capituloResultado({ narrar, hasta }) {
    if (estado.enjambre.terminado) reiniciar();
    estado.ocultarParticulas = false;
    estado.congelado = false;
    estado.etiquetasF = false;
    estado.destacarInicial = -1;
    estado.fuerzasPaso = 4;
    estado.verFuerzas = false;
    estado.modoCam = 'enjambre'; // la cámara acompaña al enjambre desde el principio del capítulo
    Sonido.lento(false);
    Sonido.barrido(true);
    Sonido.intensidad(0.45);
    estado.iterPorSegundo = 2.5;
    estado.reproduciendo = true;
    actualizarPanel();

    const funcion = FUNCIONES[estado.funcion];
    const pal = palabras();
    await narrar(
      `Y las ${estado.n} hacen lo mismo, al mismo tiempo, en cada iteración.`,
      `Y las ${estado.n} hacen lo mismo, al mismo tiempo, en cada iteración.`,
      5500
    );

    estado.iterPorSegundo = 5;
    Sonido.intensidad(0.6);
    await narrar(
      'Cada vez que alguien encuentra un lugar mejor, <b>todo el enjambre se entera</b>.',
      'Cada vez que alguien encuentra un lugar mejor, todo el enjambre se entera.',
      5500
    );

    Sonido.barrido(true);
    Sonido.intensidad(1);
    estado.modoCam = 'enjambre';
    estado.iterPorSegundo = 12;
    await narrar('Aceleremos… y acerquemos la cámara.', 'Aceleremos, y acerquemos la cámara.', 1000);
    // Se espera a que el ciclo principal registre el final, para que su aviso no tape este.
    await hasta(() => estado.notificado);

    const g = estado.enjambre.gBest;
    const llego = Math.min(...funcion.optimos.map((m) => Math.hypot(g.x - m.x, g.y - m.y))) < 0.05;
    const cual = funcion.optimos.length > 1 ? `uno de los ${pal.optimos}` : `el ${pal.optimo}`;
    const local = `${maximizando() ? 'máximo' : 'mínimo'} local`;
    Sonido.intensidad(0);
    Sonido.final();
    await narrar(
      `Después de ${estado.enjambre.maxIter} iteraciones: <span class="sin-corte"><b>${fAmigable(g.f)}</b></span>.<br>` +
        (llego
          ? `¡Encontraron ${cual} sin que ninguna supiera dónde estaba!`
          : `Se quedaron en un ${local}: PSO no garantiza encontrar el óptimo global.`),
      llego
        ? `Después de ${estado.enjambre.maxIter} iteraciones, encontraron ${cual}, sin que ninguna supiera dónde estaba.`
        : `Después de ${estado.enjambre.maxIter} iteraciones, se quedaron en un ${local}. PSO no garantiza encontrar el óptimo global.`,
      2500
    );

    // Remate: la cámara retrocede y se dibuja el camino que siguió el gBest, con el resumen.
    const fInicial = estado.enjambre.historial[0].gBest;
    estado.modoCam = 'completa';
    estado.camino = { t0: performance.now() + 900 }; // empieza cuando la cámara ya retrocedió
    Sonido.barrido(false);
    mostrarResumen(llego);
    await narrar(
      `Este fue el camino del <b>gBest</b>: empezó en f = ${fmt(fInicial, 2)} y terminó en <span class="sin-corte">${fAmigable(g.f)}</span>.`,
      `Y este fue el camino del mejor global: empezó en ${numeroHablado(fInicial)} y terminó ` +
        (Math.abs(g.f) < 0.05 ? 'prácticamente en cero.' : `en ${numeroHablado(g.f)}.`),
      5000
    );

    // Mapa de exploración: en color lo que el enjambre visitó, en gris lo que nunca miró.
    if (usaMapaGL()) {
      estado.verExploracion = true;
      Sonido.barrido(true);
      await narrar(
        'Y aquí está todo lo que exploró: <b>en color</b> lo que visitó; <b>en gris</b>, lo que nunca miró.',
        'Y aquí está todo lo que exploró. En color, las zonas que visitó; en gris, las que nunca miró: se concentró en lo prometedor.',
        5500
      );
    }
  }

  // ---------------------------------------------------------------- eventos

  function enlazarParametro(id, clave, decimales) {
    $(id).addEventListener('input', (ev) => {
      estado[clave] = parseFloat(ev.target.value);
      $('v-' + clave).textContent = estado[clave].toFixed(decimales);
      estado.enjambre[clave] = estado[clave]; // se aplica en caliente, sin reiniciar
      detectarEscenario();
      sincronizarControles();
    });
  }

  enlazarParametro('r-w', 'w', 2);
  enlazarParametro('r-c1', 'c1', 1);
  enlazarParametro('r-c2', 'c2', 1);

  $('chk-decaimiento').addEventListener('change', (ev) => {
    estado.decaimiento = ev.target.checked;
    estado.enjambre.decaimiento = estado.decaimiento;
    detectarEscenario();
    sincronizarControles();
    actualizarPanel();
  });

  $('r-n').addEventListener('input', (ev) => {
    estado.n = parseInt(ev.target.value, 10);
    $('v-n').textContent = estado.n;
    reiniciar();
  });

  $('r-vel').addEventListener('input', (ev) => {
    estado.iterPorSegundo = parseInt(ev.target.value, 10);
    $('v-vel').textContent = `${estado.iterPorSegundo} it/s`;
  });

  $('sel-funcion').addEventListener('change', (ev) => {
    estado.funcion = ev.target.value;
    prepararFuncion();
    if (estado.modo === 'reto') iniciarReto();
    else {
      reiniciar();
      const F = FUNCIONES[estado.funcion];
      subtitulo(`<b>${F.nombre}</b>: ${minusculaInicial(F.descripcion)}`, 4000);
      mostrar3DGrande(true, 4000); // la superficie en grande unos segundos y luego se encoge
    }
  });

  function alternarVistas(visible) {
    $('lateral').classList.toggle('oculto', !visible);
    $('chk-vistas').checked = visible;
    ajustarTamano();
  }
  $('chk-vistas').addEventListener('change', (ev) => alternarVistas(ev.target.checked));

  $('in-semilla').addEventListener('change', (ev) => {
    const v = parseInt(ev.target.value, 10);
    if (Number.isFinite(v) && v > 0) {
      estado.semilla = v;
      reiniciar();
    }
  });

  $('btn-semilla').addEventListener('click', () => {
    nuevaSemilla();
    reiniciar();
  });

  const toggles = {
    'chk-estelas': 'verEstelas',
    'chk-pbest': 'verPBest',
    'chk-fuerzas': 'verFuerzas',
    'chk-minimo': 'verMinimo',
    'chk-camara': 'camAuto',
  };
  for (const [id, clave] of Object.entries(toggles)) {
    $(id).addEventListener('change', (ev) => {
      estado[clave] = ev.target.checked;
      actualizarPanel();
    });
  }

  document.querySelectorAll('[data-escenario]').forEach((b) => {
    b.addEventListener('click', () => aplicarEscenario(b.dataset.escenario));
  });

  $('btn-play').addEventListener('click', alternarReproduccion);
  $('btn-paso').addEventListener('click', pasoManual);
  $('btn-reiniciar').addEventListener('click', () => (estado.modo === 'reto' ? iniciarReto() : reiniciar()));
  $('btn-modo-sim').addEventListener('click', iniciarSimulacion);
  $('btn-modo-reto').addEventListener('click', iniciarReto);
  $('btn-historia').addEventListener('click', iniciarHistoria);
  document.querySelectorAll('[data-capitulo]').forEach((b) => {
    b.addEventListener('click', () => irACapitulo(Number(b.dataset.capitulo)));
  });
  lienzo.addEventListener('click', clicEnMapa);

  // ---- Bandada gigante: 2.000 partículas, posibles porque las dibuja la tarjeta gráfica.
  const PARTICULAS_BANDADA = 2000;

  function alternarBandada() {
    if (estado.modo !== 'sim') iniciarSimulacion();
    const activar = estado.n < PARTICULAS_BANDADA;
    if (activar) estado.nAnterior = estado.n;
    estado.n = activar ? PARTICULAS_BANDADA : estado.nAnterior || 30;
    $('r-n').value = Math.min(estado.n, 100);
    $('v-n').textContent = estado.n.toLocaleString('es-CO');
    $('btn-bandada').classList.toggle('activo', activar);
    $('btn-bandada').textContent = activar ? 'Volver a 30 partículas' : 'Bandada gigante: 2.000 partículas';
    reiniciar();
    estado.reproduciendo = true;
    Sonido.barrido(true);
    subtitulo(
      activar
        ? `Bandada de <b>${PARTICULAS_BANDADA.toLocaleString('es-CO')} partículas</b>: misma regla, muchas más aves.`
        : `De vuelta a <b>${estado.n} partículas</b>.`,
      3000
    );
    actualizarPanel();
  }

  function alternarExploracion(visible) {
    estado.verExploracion = visible;
    $('chk-exploracion').checked = visible;
    if (visible && !usaMapaGL()) avisoVoz('El mapa de exploración necesita la tarjeta gráfica (WebGL), que no está disponible en este navegador.', 5000);
  }

  $('btn-bandada').addEventListener('click', alternarBandada);
  $('chk-relieve').addEventListener('change', (ev) => {
    estado.verRelieve = ev.target.checked;
  });
  $('chk-exploracion').addEventListener('change', (ev) => alternarExploracion(ev.target.checked));

  // ---- Zoom y arrastre manual del mapa (en simulación libre; el reto y la narración usan su cámara).
  const MITAD_MANUAL = 0.01; // zoom manual máximo: una vista de 0,02 de lado
  let arrastreMapa = null;
  let huboArrastreMapa = false;

  function camaraManualPermitida() {
    return estado.modo === 'sim' && !estado.historia;
  }

  lienzo.addEventListener(
    'wheel',
    (ev) => {
      if (!camaraManualPermitida()) return;
      ev.preventDefault();
      const r = lienzo.getBoundingClientRect();
      const c = estado.camara;
      // El punto bajo el cursor se queda quieto mientras se acerca o se aleja.
      const [wx, wy] = aDominio(ev.clientX - r.left, ev.clientY - r.top);
      const mitad = acotarVista({ cx: c.cx, cy: c.cy, mitad: c.mitad * Math.exp(ev.deltaY * 0.0015) }, MITAD_MANUAL).mitad;
      const k = mitad / c.mitad;
      estado.camManual = acotarVista({ cx: wx + (c.cx - wx) * k, cy: wy + (c.cy - wy) * k, mitad }, MITAD_MANUAL);
      estado.modoCam = 'manual';
    },
    { passive: false }
  );

  lienzo.addEventListener('pointerdown', (ev) => {
    if (!camaraManualPermitida() || ev.button !== 0) return;
    arrastreMapa = { x: ev.clientX, y: ev.clientY, movido: 0 };
    huboArrastreMapa = false;
  });

  window.addEventListener('pointermove', (ev) => {
    if (!arrastreMapa) return;
    const dx = ev.clientX - arrastreMapa.x;
    const dy = ev.clientY - arrastreMapa.y;
    arrastreMapa.movido += Math.abs(dx) + Math.abs(dy);
    if (arrastreMapa.movido < 5) return; // un clic con pulso tembloroso no es un arrastre
    huboArrastreMapa = true;
    const c = estado.camara;
    const porPixel = (2 * c.mitad) / estado.lado;
    estado.camManual = acotarVista({ cx: c.cx - dx * porPixel, cy: c.cy + dy * porPixel, mitad: c.mitad }, MITAD_MANUAL);
    estado.modoCam = 'manual';
    arrastreMapa.x = ev.clientX;
    arrastreMapa.y = ev.clientY;
  });

  window.addEventListener('pointerup', () => {
    arrastreMapa = null;
  });

  lienzo.addEventListener('dblclick', () => {
    if (camaraManualPermitida()) estado.modoCam = 'auto';
  });

  // ---- 3D interactivo: arrastrar gira, la rueda acerca, doble clic vuelve al giro automático.
  function enlazarControl3D(lienzo3d) {
    let arrastrando = false;
    let ux = 0;
    let uy = 0;
    lienzo3d.addEventListener('pointerdown', (ev) => {
      arrastrando = true;
      ux = ev.clientX;
      uy = ev.clientY;
      ctl3d.manual = true;
      lienzo3d.setPointerCapture(ev.pointerId);
      actualizarPista3D();
    });
    lienzo3d.addEventListener('pointermove', (ev) => {
      if (!arrastrando) return;
      angulo3d += (ev.clientX - ux) * 0.01;
      ctl3d.elevacion = Math.min(1.45, Math.max(0.12, ctl3d.elevacion + (ev.clientY - uy) * 0.008));
      ux = ev.clientX;
      uy = ev.clientY;
    });
    const soltar = () => {
      arrastrando = false;
    };
    lienzo3d.addEventListener('pointerup', soltar);
    lienzo3d.addEventListener('pointercancel', soltar);
    lienzo3d.addEventListener(
      'wheel',
      (ev) => {
        ev.preventDefault();
        ctl3d.manual = true;
        ctl3d.zoom = Math.min(3.5, Math.max(0.5, ctl3d.zoom * Math.exp(-ev.deltaY * 0.0012)));
        actualizarPista3D();
      },
      { passive: false }
    );
    lienzo3d.addEventListener('dblclick', () => {
      ctl3d.manual = false;
      // Se lleva el ángulo a la vuelta más cercana, para que regrese por el camino corto.
      angulo3d = Math.atan2(Math.sin(angulo3d), Math.cos(angulo3d));
      actualizarPista3D();
    });
  }

  function actualizarPista3D() {
    $('pista-3d').textContent = ctl3d.manual
      ? 'Control manual · doble clic: volver al giro automático'
      : 'Arrastra para girar · rueda para acercar';
  }

  /** Abre o cierra el 3D grande para manejarlo con el mouse (botón Ampliar o tecla D). */
  function alternar3DGrande() {
    if (estado.modo === 'reto') return; // en el reto revelaría el terreno
    mostrar3DGrande(!cajaGrande3d.classList.contains('visible'));
  }

  enlazarControl3D(vista3d);
  enlazarControl3D(grande3d);
  $('btn-ampliar-3d').addEventListener('click', alternar3DGrande);

  // Cualquier clic fuera del botón de la explicación la detiene y devuelve el control.
  document.addEventListener(
    'pointerdown',
    (ev) => {
      desbloquearSonido(); // el navegador solo permite sonido después de una interacción
      const enSonido = ev.target.closest('#sel-voz, #r-volumen, #btn-probar-voz');
      const enHistoria = ev.target.closest('#btn-historia, [data-capitulo]');
      // Girar o ampliar el 3D no interrumpe la narración ni saca del modo cine.
      const en3D = ev.target.closest('#vista3d, #vista3d-grande, #btn-ampliar-3d');
      if (estado.historia && !enSonido && !enHistoria && !en3D) cancelarHistoria();
      // En modo cine los controles están ocultos: un clic los vuelve a mostrar.
      if (!enHistoria && !en3D) modoCine(false);
    },
    true
  );

  // Que los botones no se queden con el foco: así Espacio siempre controla la simulación.
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (b) b.blur();
  });

  document.addEventListener('keydown', (ev) => {
    const etiqueta = ev.target.tagName;
    if (etiqueta === 'INPUT' || etiqueta === 'SELECT' || etiqueta === 'TEXTAREA') return;
    const tecla = ev.key.toLowerCase();
    desbloquearSonido();
    if (tecla === 'f') return pantallaCompleta();
    if (tecla === 'h') return iniciarHistoria();
    if (tecla === 'm') return alternarSilencio();
    if (tecla === 'd') return alternar3DGrande(); // 3D grande; no interrumpe la narración
    if (tecla === 'escape') {
      // Esc detiene la narración y vuelve a mostrar los controles.
      cancelarHistoria();
      return modoCine(false);
    }
    // Capítulos: Av Pág / Re Pág, que son las teclas que envían los presentadores inalámbricos.
    if (tecla === 'pagedown') {
      ev.preventDefault();
      return siguienteCapitulo();
    }
    if (tecla === 'pageup') {
      ev.preventDefault();
      return capituloAnterior();
    }
    if (estado.historia) {
      // Durante la explicación, cualquier otra tecla la detiene.
      ev.preventDefault();
      cancelarHistoria();
      return modoCine(false);
    }
    if (tecla === ' ') {
      ev.preventDefault();
      if (estado.modo === 'reto' && estado.reto.fase === 'listo') soltarEnjambre();
      else alternarReproduccion();
    } else if (tecla === 'n' || tecla === 'arrowright') pasoManual();
    else if (tecla === 'r') (estado.modo === 'reto' ? iniciarReto : reiniciar)();
    else if (tecla === '1') aplicarEscenario('A');
    else if (tecla === '2') aplicarEscenario('B');
    else if (tecla === '3') aplicarEscenario('C');
    else if (tecla === 'j') (estado.modo === 'reto' ? iniciarSimulacion : iniciarReto)();
    else if (tecla === 'g') alternarVistas($('lateral').classList.contains('oculto'));
    else if (tecla === 'x') alternarExploracion(!estado.verExploracion);
    else if (tecla === 'b') alternarBandada();
    else if (tecla === 'c') {
      estado.camAuto = !estado.camAuto;
      $('chk-camara').checked = estado.camAuto;
    } else if (tecla === 'v') {
      estado.verFuerzas = !estado.verFuerzas;
      $('chk-fuerzas').checked = estado.verFuerzas;
      actualizarPanel();
    } else if (tecla === 't') {
      estado.verEstelas = !estado.verEstelas;
      $('chk-estelas').checked = estado.verEstelas;
    }
  });

  // ---------------------------------------------------------------- sonido

  function llenarVoces() {
    const sel = $('sel-voz');
    const voces = Sonido.voces();
    const actual = Sonido.vozActual();
    sel.innerHTML = '';
    for (const v of voces) {
      const opcion = document.createElement('option');
      opcion.value = v.name;
      opcion.textContent = `${v.name} (${v.lang})`;
      opcion.selected = !!actual && v.name === actual.name;
      sel.appendChild(opcion);
    }
    sel.disabled = voces.length === 0;
    const nota = $('nota-voz');
    const fallidas = Sonido.vocesFallidas();
    if (!voces.length) {
      nota.textContent = 'No hay voces en español disponibles: la explicación tendrá solo subtítulos.';
    } else if (fallidas.length && actual) {
      nota.textContent =
        `La voz en línea no respondió (${fallidas[0].replace(/^Microsoft /, '').replace(/ - .*$/, '')}), ` +
        `así que se está usando ${actual.name.replace(/^Microsoft /, '').replace(/ - .*$/, '')}, que está instalada en el equipo. ` +
        'Revisa la conexión a internet, la VPN o el antivirus, o elige otra voz en la lista.';
    } else if (fallidas.length) {
      nota.textContent = 'Ninguna voz respondió: la explicación seguirá solo con subtítulos.';
    } else if (!Sonido.esLatinoamericana(actual)) {
      nota.textContent = 'Solo hay voces de España. Para una voz latinoamericana natural, abre la página en Microsoft Edge con internet.';
    } else if (!/natural/i.test(actual.name)) {
      nota.textContent = 'Para una voz más natural, abre la página en Microsoft Edge con internet.';
    } else {
      nota.textContent = '';
    }
  }

  let volumenAntesDeSilenciar = 0.8;

  function mostrarVolumen(v) {
    $('r-volumen').value = v;
    $('v-volumen').textContent = `${Math.round(v * 100)} %`;
  }

  function alternarSilencio() {
    const { volumen } = Sonido.preferencias();
    if (volumen > 0) {
      volumenAntesDeSilenciar = volumen;
      Sonido.configurar({ volumen: 0 });
      Sonido.callar();
      mostrarVolumen(0);
      if (!estado.historia) subtitulo('Sonido apagado', 1200);
    } else {
      Sonido.configurar({ volumen: volumenAntesDeSilenciar });
      mostrarVolumen(volumenAntesDeSilenciar);
      if (!estado.historia) subtitulo('Sonido encendido', 1200);
    }
  }

  let temporizadorAvisoVoz = null;

  function avisoVoz(html, ms = 7000) {
    const a = $('aviso-voz');
    clearTimeout(temporizadorAvisoVoz);
    a.innerHTML = html;
    a.classList.add('visible');
    temporizadorAvisoVoz = setTimeout(() => a.classList.remove('visible'), ms);
  }

  /** Mensaje según la voz que quedó en uso después de que la de Edge no respondiera. */
  function textoVozAlternativa(nueva) {
    return nueva
      ? `Usando <b>${Sonido.nombreCorto(nueva)}</b>${nueva.localService ? ', instalada en el equipo' : ''}.`
      : 'No hay otra voz disponible: la explicación seguirá solo con subtítulos.';
  }

  Sonido.alCambiarVoces(llenarVoces);
  // Si la voz de Edge falla, se cambia sola a otra y se avisa en pantalla y en el panel.
  Sonido.alCambiarVozActiva((fallida, nueva) => {
    llenarVoces();
    avisoVoz(`La voz de Edge <b>${Sonido.nombreCorto(fallida)}</b> no está disponible ahora. ${textoVozAlternativa(nueva)}`);
  });

  let avisoSinEdgeMostrado = false;

  /** Al iniciar la narración: si este navegador no tiene voces de Edge, se avisa una vez. */
  function revisarVozDeEdge() {
    const { voz } = Sonido.preferencias();
    // Si la voz de Edge ya falló, ya se avisó con el mensaje correcto.
    if (!voz || avisoSinEdgeMostrado || Sonido.vocesFallidas().length) return;
    const actual = Sonido.vozActual();
    if (actual && Sonido.esDeEdge(actual)) return;
    avisoSinEdgeMostrado = true;
    avisoVoz(`La voz de Edge no está disponible en este navegador. ${textoVozAlternativa(actual)}`);
  }

  function desbloquearSonido() {
    Sonido.desbloquear();
    Sonido.probarVoz(); // con la primera interacción se comprueba en silencio que la voz responda
  }
  llenarVoces();

  $('sel-voz').addEventListener('change', (ev) => {
    Sonido.elegirVoz(ev.target.value);
    llenarVoces();
  });
  $('chk-voz').addEventListener('change', (ev) => Sonido.configurar({ voz: ev.target.checked }));
  $('chk-musica').addEventListener('change', (ev) => Sonido.configurar({ musica: ev.target.checked }));
  $('chk-efectos').addEventListener('change', (ev) => Sonido.configurar({ efectos: ev.target.checked }));
  $('r-volumen').addEventListener('input', (ev) => {
    const v = parseFloat(ev.target.value);
    Sonido.configurar({ volumen: v });
    mostrarVolumen(v);
  });
  $('btn-probar-voz').addEventListener('click', () => {
    Sonido.desbloquear();
    Sonido.decir('Hola. Así sonará la explicación del enjambre de partículas.');
  });

  window.addEventListener('resize', ajustarTamano);
  document.addEventListener('fullscreenchange', ajustarTamano);

  // ---------------------------------------------------------------- arranque

  // Se puede abrir con una función elegida: index.html?funcion=himmelblau
  const funcionPedida = new URLSearchParams(location.search).get('funcion');
  if (funcionPedida && FUNCIONES[funcionPedida]) {
    estado.funcion = funcionPedida;
    $('sel-funcion').value = funcionPedida;
  }
  prepararFuncion();
  sincronizarControles();
  reiniciar();
  ajustarTamano();
  if (location.hash === '#auto') estado.reproduciendo = true;
  if (location.hash === '#reto') iniciarReto();
  if (location.hash === '#historia') iniciarHistoria();
  if (location.hash === '#fuerzas') {
    for (let i = 0; i < 3; i++) avanzar();
    estado.progreso = 1;
    estado.verFuerzas = true;
    estado.modoCam = 'particula';
    $('chk-fuerzas').checked = true;
    actualizarPanel();
  }
  requestAnimationFrame(cuadro);
})();
