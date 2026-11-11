/*
 * Dibujo por tarjeta gráfica (WebGL): mapa 2D, superficie 3D y partículas.
 *
 * - La función se evalúa en la propia tarjeta: en cada píxel para el mapa y en cada
 *   vértice para la superficie. Todo se ve nítido a cualquier zoom.
 * - El mapa solo se recalcula cuando cambia la cámara (se guarda en una imagen de la
 *   tarjeta); en cada cuadro se copia esa imagen y encima se pintan las partículas.
 * - Las partículas se dibujan con brillo sumado (resplandor). En el 3D se dibujan dentro
 *   de la escena: si quedan detrás de una montaña, la montaña las tapa.
 * - Relieve: el mapa se sombrea según la pendiente, con una luz lateral.
 * - Exploración: una imagen de 256 × 256 dice cuánto pasó el enjambre por cada zona;
 *   lo nunca visitado se ve en gris.
 *
 * Si el equipo no tiene WebGL, crear y crearSuperficie devuelven null y app.js usa
 * el dibujo por procesador. Las fórmulas deben coincidir con las de pso.js.
 */
(function () {
  'use strict';

  const CLAVES = ['rastrigin', 'esfera', 'ackley', 'himmelblau', 'griewank', 'picos', 'cordillera'];

  /** Número de JavaScript escrito como decimal válido en GLSL (siempre con punto). */
  function glsl(v) {
    const s = String(v);
    return /[.e]/.test(s) ? `(${s})` : `(${s}.0)`;
  }

  // La cordillera se escribe en GLSL a partir de los mismos datos de pso.js (una sola fuente de verdad).
  const DATOS_CORDILLERA = window.PSO && window.PSO.FUNCIONES.cordillera;
  const CORDILLERA = DATOS_CORDILLERA
    ? `float cordillera(float x, float y) {
        float s = ${glsl(DATOS_CORDILLERA.ondas[0])} * sin(0.9 * x) * cos(0.8 * y)
                + ${glsl(DATOS_CORDILLERA.ondas[1])} * sin(2.1 * x + 1.3 * y) * cos(1.1 * x - 1.7 * y)
                + ${glsl(DATOS_CORDILLERA.ondas[2])} * sin(3.4 * x + 0.5) * sin(3.1 * y);
        ${DATOS_CORDILLERA.montes
          .map(
            ([a, b, h, w]) =>
              `s += ${glsl(h)} * exp(-((x - ${glsl(a)}) * (x - ${glsl(a)}) + (y - ${glsl(b)}) * (y - ${glsl(b)})) / ${glsl(2 * w * w)});`
          )
          .join('\n        ')}
        return s;
      }`
    : 'float cordillera(float x, float y) { return 0.0; }';
  const LADO_EXPLORACION = 256;
  const DATOS_POR_PUNTO = 5; // x, y, tamaño en píxeles, opacidad, tipo (0 partícula, 1 halo del gBest)

  // Palabras que cambian entre WebGL 2 (GLSL ES 3.00) y WebGL 1 (GLSL ES 1.00).
  const DIALECTO = {
    2: {
      cabecera: '#version 300 es\n#define texture2D texture\n',
      atributo: 'in',
      sale: 'out',
      entra: 'in',
      declaraColor: 'out vec4 salida;',
      color: 'salida',
      extension: '',
    },
    1: {
      cabecera: '',
      atributo: 'attribute',
      sale: 'varying',
      entra: 'varying',
      declaraColor: '',
      color: 'gl_FragColor',
      extension: '#extension GL_OES_standard_derivatives : enable\n',
    },
  };

  // Lo que comparten el mapa, la superficie y las partículas del 3D: la función y su altura.
  const COMUN = `
    uniform vec2 uCentro;      // centro de la zona visible, en coordenadas de la función
    uniform float uMitad;      // mitad del lado de la zona visible
    uniform int uFuncion;
    uniform float uMaximizar;  // 1.0 si se busca el máximo
    uniform float uOptimo;     // valor óptimo de f
    uniform float uBajo;       // altura mínima de la zona visible
    uniform float uRango;      // altura máxima menos mínima

    const float TAU = 6.283185307179586;

    ${CORDILLERA}

    float f(vec2 p) {
      float x = p.x;
      float y = p.y;
      if (uFuncion == 6) return cordillera(x, y);
      if (uFuncion == 0) return 20.0 + x * x + y * y - 10.0 * (cos(TAU * x) + cos(TAU * y));
      if (uFuncion == 1) return x * x + y * y;
      if (uFuncion == 2) return -20.0 * exp(-0.2 * sqrt(0.5 * (x * x + y * y)))
                                - exp(0.5 * (cos(TAU * x) + cos(TAU * y))) + 2.718281828459045 + 20.0;
      if (uFuncion == 3) {
        float a = x * x + y - 11.0;
        float b = x + y * y - 7.0;
        return a * a + b * b;
      }
      if (uFuncion == 4) return 1.0 + (x * x + y * y) / 4000.0 - cos(x) * cos(y / 1.4142135623730951);
      float u = 1.0 - x;
      float v = y + 1.0;
      float w = x + 1.0;
      return 3.0 * u * u * exp(-x * x - v * v)
           - 10.0 * (x / 5.0 - x * x * x - y * y * y * y * y) * exp(-x * x - y * y)
           - exp(-w * w - y * y) / 3.0;
    }

    // Igual que alturaVisual() en app.js: log(1 + f − f*) al minimizar, f al maximizar.
    float altura(vec2 p) {
      float v = f(p);
      return uMaximizar > 0.5 ? v : log(1.0 + max(0.0, v - uOptimo));
    }

    // Altura de 0 (lo más bajo de la zona visible) a 1 (lo más alto).
    float altura01(vec2 p) {
      return (altura(p) - uBajo) / uRango;
    }
  `;

  const PALETA = `
    uniform vec3 uColores[6];
    uniform float uParadas[6];
    vec3 paleta(float t) {
      vec3 c = uColores[0];
      for (int i = 1; i < 6; i++) {
        float k = clamp((t - uParadas[i - 1]) / (uParadas[i] - uParadas[i - 1]), 0.0, 1.0);
        c = mix(c, uColores[i], k);
      }
      return c;
    }
  `;

  // Curvas de nivel de ~1 píxel, suavizadas con la derivada en pantalla.
  const CURVAS = `
    float curvaDeNivel(float t, float bandas) {
      float b = t * bandas;
      float fr = fract(b);
      float distancia = min(fr, 1.0 - fr) / max(fwidth(b), 1e-6);
      return t > 0.03 ? clamp(1.0 - distancia / 0.9, 0.0, 1.0) : 0.0;
    }
  `;

  // Proyección del 3D: la misma de proyectar() en app.js, para que lo que se dibuja
  // encima (flechas, rótulos) caiga exactamente sobre la superficie.
  const PROYECCION = `
    uniform vec4 uGiro;       // cos y sen del giro, cos y sen de la inclinación
    uniform float uEscala;    // tamaño en píxeles de una unidad
    uniform vec2 uCentroPx;   // punto de la pantalla donde va el centro
    uniform vec2 uTamano;     // tamaño del lienzo en píxeles de diseño
    // Devuelve la posición en pantalla (x, y) y la profundidad (z).
    vec3 proyectar(vec2 xy, float t) {
      float xr = xy.x * uGiro.x - xy.y * uGiro.y;
      float yr = xy.x * uGiro.y + xy.y * uGiro.x;
      float zh = t * 0.8 - 0.35;
      float profundidad = yr * uGiro.z - zh * uGiro.w;
      float escala = uEscala / (1.0 + profundidad * 0.12);
      return vec3(uCentroPx.x + xr * escala, uCentroPx.y - (yr * uGiro.w + zh * uGiro.z) * escala, profundidad);
    }
    vec4 aPantalla(vec3 q) {
      return vec4(q.x / uTamano.x * 2.0 - 1.0, 1.0 - q.y / uTamano.y * 2.0, clamp(q.z * 0.4, -1.0, 1.0), 1.0);
    }
  `;

  // Brillo de cada partícula: núcleo blanco con halo salmón; el gBest, un halo grande.
  // Se devuelve con la opacidad ya multiplicada, para sumarlo sobre lo que haya debajo.
  function fragmentoPuntos(d) {
    return `${d.cabecera}precision highp float;
      ${d.declaraColor}
      ${d.entra} vec2 vDatos; // opacidad, tipo
      void main() {
        vec2 c = gl_PointCoord * 2.0 - 1.0;
        float r = length(c);
        if (r > 1.0) discard;
        vec3 color;
        float a;
        if (vDatos.y < 0.5) {
          float nucleo = smoothstep(0.26, 0.17, r);
          float halo = exp(-r * r * 6.0) * 0.8;
          color = mix(vec3(0.95, 0.55, 0.50) * halo, vec3(1.0, 0.96, 0.95), nucleo);
          a = max(nucleo, halo);
        } else {
          float halo = exp(-r * r * 3.5) * 0.5;
          color = vec3(0.95, 0.55, 0.50) * halo;
          a = halo;
        }
        ${d.color} = vec4(color, a) * vDatos.x;
      }`;
  }

  function fuentesMapa(d) {
    return {
      vertice: `${d.cabecera}${d.atributo} vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,
      fragmento: `${d.cabecera}${d.extension}precision highp float;
        ${d.declaraColor}
        uniform vec2 uTamanoMapa;  // tamaño de la imagen del mapa en píxeles
        uniform float uBandas;     // cantidad de curvas de nivel
        uniform float uRelieve;    // 1.0 para sombrear según la pendiente
        uniform float uExplorar;   // 1.0 para mostrar lo explorado y lo no visitado
        uniform sampler2D uExplorada;
        uniform vec2 uDominio;     // límites del dominio (a, b) en los que se mide la exploración
        ${COMUN}
        ${PALETA}
        ${CURVAS}
        void main() {
          vec2 uv = gl_FragCoord.xy / uTamanoMapa;
          vec2 p = uCentro + (uv * 2.0 - 1.0) * uMitad;
          float t = altura01(p);
          vec3 color = paleta(clamp(t, 0.0, 1.0));

          // Relieve: normal a partir de la pendiente en pantalla y luz desde arriba a la izquierda.
          float k = 40.0 * uTamanoMapa.y / 900.0;
          vec3 normal = normalize(vec3(-dFdx(t) * k, -dFdy(t) * k, 1.0));
          float luz = dot(normal, vec3(-0.5518, 0.6020, 0.6020));
          color *= mix(1.0, clamp(1.0 + 1.1 * (luz - 0.602), 0.45, 1.5), uRelieve);

          color *= 1.0 - 0.2 * curvaDeNivel(t, uBandas);

          // Exploración: lo visitado conserva su color (con un toque cálido); lo demás, gris.
          vec2 q = (p - uDominio.x) / (uDominio.y - uDominio.x);
          float dentro = step(0.0, q.x) * step(0.0, q.y) * step(q.x, 1.0) * step(q.y, 1.0);
          float e = texture2D(uExplorada, clamp(q, 0.0, 1.0)).r * dentro;
          vec3 gris = vec3(dot(color, vec3(0.3, 0.59, 0.11))) * 0.32;
          vec3 calido = color * (1.0 + 0.25 * e) + vec3(0.22, 0.08, 0.05) * e;
          // Umbral bajo: basta con que una partícula haya pasado una vez para que la zona se vea en color.
          color = mix(color, mix(gris, calido, smoothstep(0.0, 0.1, e)), uExplorar);

          ${d.color} = vec4(color, 1.0);
        }`,
    };
  }

  function fuentesCopia(d) {
    return {
      vertice: `${d.cabecera}${d.atributo} vec2 aPos;\nvoid main() { gl_Position = vec4(aPos, 0.0, 1.0); }`,
      fragmento: `${d.cabecera}precision highp float;
        ${d.declaraColor}
        uniform sampler2D uImagen;
        uniform vec2 uTamanoMapa;
        void main() { ${d.color} = texture2D(uImagen, gl_FragCoord.xy / uTamanoMapa); }`,
    };
  }

  function fuentesPuntos2D(d) {
    return {
      vertice: `${d.cabecera}precision highp float;
        ${d.atributo} vec2 aPos;
        ${d.atributo} vec3 aDatos; // tamaño, opacidad, tipo
        ${d.sale} vec2 vDatos;
        uniform vec2 uVista;   // centro de la cámara
        uniform float uRadio;  // mitad del lado de la cámara
        uniform float uDpr;
        void main() {
          gl_Position = vec4((aPos - uVista) / uRadio, 0.0, 1.0);
          gl_PointSize = aDatos.x * uDpr;
          vDatos = aDatos.yz;
        }`,
      fragmento: fragmentoPuntos(d),
    };
  }

  function fuentesSuperficie(d) {
    return {
      vertice: `${d.cabecera}precision highp float;
        ${d.atributo} vec2 aUV;   // posición en la malla, de 0 a 1
        ${d.sale} vec3 vColor;
        ${d.sale} float vAltura;
        uniform float uPaso;      // separación entre vértices, en unidades de la malla
        ${COMUN}
        ${PALETA}
        ${PROYECCION}
        const vec3 LUZ = vec3(-0.4514, -0.3511, 0.8226);
        void main() {
          vec2 xy = aUV * 2.0 - 1.0;
          vec2 p = uCentro + xy * uMitad;
          float t = clamp(altura01(p), -0.05, 1.25);
          vec2 dx = vec2(uPaso * uMitad, 0.0);
          float dzx = (altura01(p + dx) - altura01(p - dx)) / (2.0 * uPaso) * 0.8;
          float dzy = (altura01(p + dx.yx) - altura01(p - dx.yx)) / (2.0 * uPaso) * 0.8;
          float luz = 0.45 + 0.55 * max(0.0, dot(normalize(vec3(-dzx, -dzy, 1.0)), LUZ));
          gl_Position = aPantalla(proyectar(xy, t));
          vColor = paleta(clamp(t, 0.0, 1.0)) * luz;
          vAltura = t;
        }`,
      fragmento: `${d.cabecera}${d.extension}precision highp float;
        ${d.declaraColor}
        ${d.entra} vec3 vColor;
        ${d.entra} float vAltura;
        ${CURVAS}
        void main() {
          ${d.color} = vec4(vColor * (1.0 - 0.22 * curvaDeNivel(vAltura, 10.0)), 1.0);
        }`,
    };
  }

  function fuentesPuntos3D(d) {
    return {
      vertice: `${d.cabecera}precision highp float;
        ${d.atributo} vec2 aPos;
        ${d.atributo} vec3 aDatos;
        ${d.sale} vec2 vDatos;
        uniform float uDpr;
        ${COMUN}
        ${PROYECCION}
        void main() {
          vec2 xy = (aPos - uCentro) / uMitad;
          float t = clamp(altura01(aPos), -0.05, 1.25) + 0.03;
          vec3 q = proyectar(xy, t);
          gl_Position = aPantalla(q);
          gl_Position.z -= 0.004; // apenas por delante de la superficie donde está posada
          bool fuera = abs(xy.x) > 1.02 || abs(xy.y) > 1.02;
          gl_PointSize = fuera ? 0.0 : aDatos.x * uDpr / (1.0 + q.z * 0.12);
          vDatos = aDatos.yz;
        }`,
      fragmento: fragmentoPuntos(d),
    };
  }

  // ---------------------------------------------------------------- utilidades de WebGL

  function compilar(gl, tipo, fuente) {
    const s = gl.createShader(tipo);
    gl.shaderSource(s, fuente);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'No se pudo compilar el sombreador');
    }
    return s;
  }

  /** Abre WebGL 2 o, si no hay, WebGL 1 con derivadas. Devuelve null si no se puede. */
  function abrir(lienzo, opciones) {
    let version = 2;
    let gl = lienzo.getContext('webgl2', opciones);
    if (!gl) {
      version = 1;
      gl = lienzo.getContext('webgl', opciones);
      if (!gl || !gl.getExtension('OES_standard_derivatives')) return null;
    }
    // Hace falta precisión alta en el sombreador de fragmentos para el zoom profundo.
    const precision = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
    if (!precision || precision.precision < 23) return null;
    return { gl, version };
  }

  /** Compila un programa y devuelve un objeto con sus uniformes y atributos por nombre. */
  function programa(gl, fuentes) {
    const p = gl.createProgram();
    gl.attachShader(p, compilar(gl, gl.VERTEX_SHADER, fuentes.vertice));
    gl.attachShader(p, compilar(gl, gl.FRAGMENT_SHADER, fuentes.fragmento));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = new Proxy({}, { get: (cache, nombre) => (nombre in cache ? cache[nombre] : (cache[nombre] = gl.getUniformLocation(p, nombre))) });
    const a = new Proxy({}, { get: (cache, nombre) => (nombre in cache ? cache[nombre] : (cache[nombre] = gl.getAttribLocation(p, nombre))) });
    return { p, u, a };
  }

  /**
   * Conecta un búfer a los atributos indicados y apaga los demás.
   * atributos: [[ubicación, componentes, desplazamiento en floats], ...]
   */
  function usarAtributos(gl, buffer, zancadaFloats, atributos) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const usados = new Set();
    for (const [ubicacion, componentes, desplazamiento] of atributos) {
      if (ubicacion < 0) continue;
      usados.add(ubicacion);
      gl.enableVertexAttribArray(ubicacion);
      gl.vertexAttribPointer(ubicacion, componentes, gl.FLOAT, false, zancadaFloats * 4, desplazamiento * 4);
    }
    for (let i = 0; i < 4; i++) if (!usados.has(i)) gl.disableVertexAttribArray(i);
  }

  /** Sube a un programa los datos de la función y de la zona visible. */
  function fijarComunes(gl, prog, v) {
    const indice = CLAVES.indexOf(v.funcion);
    if (indice < 0) return false;
    const { u } = prog;
    gl.uniform2f(u.uCentro, v.cx, v.cy);
    gl.uniform1f(u.uMitad, v.mitad);
    gl.uniform1i(u.uFuncion, indice);
    gl.uniform1f(u.uMaximizar, v.maximizar ? 1 : 0);
    gl.uniform1f(u.uOptimo, v.optimo);
    gl.uniform1f(u.uBajo, v.bajo);
    gl.uniform1f(u.uRango, v.rango);
    return true;
  }

  function fijarPaleta(gl, prog, paleta) {
    gl.useProgram(prog.p);
    gl.uniform3fv(prog.u.uColores, new Float32Array(paleta.flatMap(([, c]) => c.map((x) => x / 255))));
    gl.uniform1fv(prog.u.uParadas, new Float32Array(paleta.map(([t]) => t)));
  }

  function fijarProyeccion(gl, prog, v) {
    gl.uniform4f(prog.u.uGiro, v.ca, v.sa, v.ce, v.se);
    gl.uniform1f(prog.u.uEscala, v.escala);
    gl.uniform2f(prog.u.uCentroPx, v.centroX, v.centroY);
    gl.uniform2f(prog.u.uTamano, v.ancho, v.alto);
  }

  function vigilarPerdida(lienzo) {
    const estado = { perdido: false };
    lienzo.addEventListener('webglcontextlost', (ev) => {
      ev.preventDefault();
      estado.perdido = true;
    });
    return estado;
  }

  /** Pinta los puntos (partículas y halo del gBest) sumando su brillo. */
  function pintarPuntos(gl, prog, bufferPuntos, puntos, cantidad) {
    if (!cantidad) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, bufferPuntos);
    gl.bufferData(gl.ARRAY_BUFFER, puntos.subarray(0, cantidad * DATOS_POR_PUNTO), gl.DYNAMIC_DRAW);
    usarAtributos(gl, bufferPuntos, DATOS_POR_PUNTO, [
      [prog.a.aPos, 2, 0],
      [prog.a.aDatos, 3, 2],
    ]);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // brillo sumado: así se ve el resplandor
    gl.drawArrays(gl.POINTS, 0, cantidad);
    gl.disable(gl.BLEND);
  }

  // ---------------------------------------------------------------- mapa 2D

  function crear(lienzo) {
    try {
      const abierto = abrir(lienzo, { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
      if (!abierto) return null;
      const { gl, version } = abierto;
      const d = DIALECTO[version];
      const progMapa = programa(gl, fuentesMapa(d));
      const progCopia = programa(gl, fuentesCopia(d));
      const progPuntos = programa(gl, fuentesPuntos2D(d));

      // Un triángulo que cubre toda la pantalla.
      const bufferPantalla = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufferPantalla);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const bufferPuntos = gl.createBuffer();

      // Imagen de la exploración (unidad 1).
      const texExploracion = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texExploracion);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, LADO_EXPLORACION, LADO_EXPLORACION, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, null);
      for (const [p, v] of [
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      ]) gl.texParameteri(gl.TEXTURE_2D, p, v);
      let versionExploracion = -1;

      // Imagen donde se guarda el mapa ya calculado (unidad 0).
      const texMapa = gl.createTexture();
      const fbMapa = gl.createFramebuffer();
      let tamanoMapa = [0, 0];
      let claveMapa = '';

      function prepararImagenMapa() {
        if (tamanoMapa[0] === lienzo.width && tamanoMapa[1] === lienzo.height) return;
        tamanoMapa = [lienzo.width, lienzo.height];
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texMapa);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, lienzo.width, lienzo.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        for (const [p, v] of [
          [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
          [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
          [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
          [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
        ]) gl.texParameteri(gl.TEXTURE_2D, p, v);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbMapa);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texMapa, 0);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        claveMapa = '';
      }

      const contexto = vigilarPerdida(lienzo);
      return {
        version,
        get disponible() {
          return !contexto.perdido;
        },
        /** paleta: [[parada, [r, g, b]], ...] con 6 colores de 0 a 255. */
        fijarPaleta(paleta) {
          fijarPaleta(gl, progMapa, paleta);
          claveMapa = '';
        },
        /**
         * v: funcion, cx, cy, mitad, maximizar, optimo, bajo, rango, bandas, relieve,
         *    explorar, exploracion { bytes, version, a, b }, puntos, cantidad, dpr
         */
        dibujar(v) {
          if (contexto.perdido) return false;
          prepararImagenMapa();

          if (v.exploracion && v.exploracion.version !== versionExploracion) {
            versionExploracion = v.exploracion.version;
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, texExploracion);
            gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LADO_EXPLORACION, LADO_EXPLORACION, gl.LUMINANCE, gl.UNSIGNED_BYTE, v.exploracion.bytes);
            if (v.explorar) claveMapa = '';
          }

          // 1. El mapa solo se recalcula si cambió la cámara, la función o lo que se muestra.
          const clave = [v.funcion, v.maximizar, v.cx, v.cy, v.mitad, v.bajo, v.rango, v.relieve, v.explorar].join('|');
          if (clave !== claveMapa) {
            gl.useProgram(progMapa.p);
            if (!fijarComunes(gl, progMapa, v)) return false;
            gl.uniform2f(progMapa.u.uTamanoMapa, lienzo.width, lienzo.height);
            gl.uniform1f(progMapa.u.uBandas, v.bandas);
            gl.uniform1f(progMapa.u.uRelieve, v.relieve ? 1 : 0);
            gl.uniform1f(progMapa.u.uExplorar, v.explorar ? 1 : 0);
            gl.uniform1i(progMapa.u.uExplorada, 1);
            const ex = v.exploracion || { a: -1, b: 1 };
            gl.uniform2f(progMapa.u.uDominio, ex.a, ex.b);
            gl.bindFramebuffer(gl.FRAMEBUFFER, fbMapa);
            gl.viewport(0, 0, lienzo.width, lienzo.height);
            usarAtributos(gl, bufferPantalla, 2, [[progMapa.a.aPos, 2, 0]]);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            claveMapa = clave;
          }

          // 2. Copia del mapa a la pantalla.
          gl.viewport(0, 0, lienzo.width, lienzo.height);
          gl.useProgram(progCopia.p);
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, texMapa);
          gl.uniform1i(progCopia.u.uImagen, 0);
          gl.uniform2f(progCopia.u.uTamanoMapa, lienzo.width, lienzo.height);
          usarAtributos(gl, bufferPantalla, 2, [[progCopia.a.aPos, 2, 0]]);
          gl.drawArrays(gl.TRIANGLES, 0, 3);

          // 3. Partículas con resplandor.
          gl.useProgram(progPuntos.p);
          gl.uniform2f(progPuntos.u.uVista, v.cx, v.cy);
          gl.uniform1f(progPuntos.u.uRadio, v.mitad);
          gl.uniform1f(progPuntos.u.uDpr, v.dpr);
          pintarPuntos(gl, progPuntos, bufferPuntos, v.puntos, v.cantidad);
          return true;
        },
      };
    } catch (err) {
      console.warn('WebGL no disponible para el mapa; se usa el dibujo por procesador.', err);
      return null;
    }
  }

  // ---------------------------------------------------------------- superficie 3D

  /** n: vértices por lado de la malla (128 da una superficie muy suave). */
  function crearSuperficie(lienzo, n = 128) {
    try {
      const abierto = abrir(lienzo, { antialias: true, alpha: true, depth: true, premultipliedAlpha: true });
      if (!abierto) return null;
      const { gl, version } = abierto;
      const d = DIALECTO[version];
      const progSup = programa(gl, fuentesSuperficie(d));
      const progPuntos = programa(gl, fuentesPuntos3D(d));

      // Malla fija: la altura de cada vértice la calcula la tarjeta, así que nunca se reconstruye.
      const uv = new Float32Array(n * n * 2);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          uv[(j * n + i) * 2] = i / (n - 1);
          uv[(j * n + i) * 2 + 1] = j / (n - 1);
        }
      }
      const indices = new Uint16Array((n - 1) * (n - 1) * 6);
      let k = 0;
      for (let j = 0; j < n - 1; j++) {
        for (let i = 0; i < n - 1; i++) {
          const a = j * n + i;
          indices.set([a, a + 1, a + n, a + 1, a + n + 1, a + n], k);
          k += 6;
        }
      }
      const bufferMalla = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, bufferMalla);
      gl.bufferData(gl.ARRAY_BUFFER, uv, gl.STATIC_DRAW);
      const bufferIndices = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufferIndices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      const bufferPuntos = gl.createBuffer();

      gl.useProgram(progSup.p);
      gl.uniform1f(progSup.u.uPaso, 2 / (n - 1));
      gl.enable(gl.DEPTH_TEST);
      gl.clearColor(0, 0, 0, 0);

      const contexto = vigilarPerdida(lienzo);
      return {
        version,
        get disponible() {
          return !contexto.perdido;
        },
        fijarPaleta: (paleta) => fijarPaleta(gl, progSup, paleta),
        /** v: datos de la función, giro {ca, sa, ce, se}, escala, centro, tamaño, puntos, cantidad, dpr. */
        dibujar(v) {
          if (contexto.perdido) return false;
          gl.viewport(0, 0, lienzo.width, lienzo.height);
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

          gl.useProgram(progSup.p);
          if (!fijarComunes(gl, progSup, v)) return false;
          fijarProyeccion(gl, progSup, v);
          usarAtributos(gl, bufferMalla, 2, [[progSup.a.aUV, 2, 0]]);
          gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, bufferIndices);
          gl.depthMask(true);
          gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);

          // Partículas dentro de la escena: la prueba de profundidad hace que las montañas las tapen.
          if (v.cantidad) {
            gl.useProgram(progPuntos.p);
            fijarComunes(gl, progPuntos, v);
            fijarProyeccion(gl, progPuntos, v);
            gl.uniform1f(progPuntos.u.uDpr, v.dpr);
            gl.depthMask(false); // los brillos no se tapan entre sí
            pintarPuntos(gl, progPuntos, bufferPuntos, v.puntos, v.cantidad);
            gl.depthMask(true);
          }
          return true;
        },
      };
    } catch (err) {
      console.warn('WebGL no disponible para la superficie 3D; se usa el dibujo por procesador.', err);
      return null;
    }
  }

  window.MapaGL = { crear, crearSuperficie, CLAVES, LADO_EXPLORACION, DATOS_POR_PUNTO };
})();
