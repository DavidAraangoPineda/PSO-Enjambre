/*
 * Optimización por Enjambre de Partículas (PSO) en dos dimensiones.
 *
 * Este archivo solo contiene el algoritmo, sin nada de dibujo, para poder
 * probarlo por separado (ver tests/pso.test.js). Funciona en el navegador
 * (queda en window.PSO) y en Node (module.exports).
 */
(function (raiz, fabrica) {
  const api = fabrica();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    raiz.PSO = api;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /**
   * Generador pseudoaleatorio con semilla (mulberry32).
   * Con la misma semilla se repite exactamente la misma corrida,
   * lo que sirve para comparar escenarios en igualdad de condiciones.
   */
  function crearRng(semilla) {
    let a = semilla >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const DOS_PI = 2 * Math.PI;

  /*
   * Cada función tiene:
   *  - objetivo: 'min' (buscar el punto más bajo) o 'max' (buscar el más alto).
   *  - optimos: todos sus óptimos globales (Himmelblau tiene cuatro mínimos).
   *  - optimo: el primero, por comodidad.
   *  - descripcion: por qué es fácil o difícil, para la narración.
   */
  const FUNCIONES = {
    rastrigin: {
      nombre: 'Rastrigin',
      formula: 'f(x,y) = 20 + x² + y² − 10[cos(2πx) + cos(2πy)]',
      descripcion: 'Tiene muchos pozos en cuadrícula, pero solo uno es el más profundo.',
      dominio: [-5.12, 5.12],
      optimos: [{ x: 0, y: 0, f: 0 }],
      f: (x, y) => 20 + x * x + y * y - 10 * (Math.cos(DOS_PI * x) + Math.cos(DOS_PI * y)),
    },
    esfera: {
      nombre: 'Esfera',
      formula: 'f(x,y) = x² + y²',
      descripcion: 'Tiene un solo pozo: es el caso más fácil.',
      dominio: [-5, 5],
      optimos: [{ x: 0, y: 0, f: 0 }],
      f: (x, y) => x * x + y * y,
    },
    ackley: {
      nombre: 'Ackley',
      formula: 'f(x,y) = −20·e^(−0.2·√(0.5(x²+y²))) − e^(0.5[cos(2πx)+cos(2πy)]) + e + 20',
      descripcion: 'Es casi plana por fuera, con un pozo profundo escondido en el centro.',
      dominio: [-5, 5],
      optimos: [{ x: 0, y: 0, f: 0 }],
      f: (x, y) =>
        -20 * Math.exp(-0.2 * Math.sqrt(0.5 * (x * x + y * y))) -
        Math.exp(0.5 * (Math.cos(DOS_PI * x) + Math.cos(DOS_PI * y))) +
        Math.E +
        20,
    },
    himmelblau: {
      nombre: 'Himmelblau',
      formula: 'f(x,y) = (x² + y − 11)² + (x + y² − 7)²',
      descripcion: 'Tiene cuatro pozos igual de profundos: cualquiera de ellos es una solución.',
      dominio: [-5, 5],
      optimos: [
        { x: 3, y: 2, f: 0 },
        { x: -2.805118, y: 3.131312, f: 0 },
        { x: -3.77931, y: -3.283186, f: 0 },
        { x: 3.584428, y: -1.848126, f: 0 },
      ],
      f: (x, y) => Math.pow(x * x + y - 11, 2) + Math.pow(x + y * y - 7, 2),
    },
    griewank: {
      nombre: 'Griewank',
      formula: 'f(x,y) = 1 + (x² + y²)/4000 − cos(x)·cos(y/√2)',
      descripcion: 'Desde lejos parece un solo pozo, pero de cerca está llena de pozos casi igual de profundos.',
      dominio: [-12, 12],
      optimos: [{ x: 0, y: 0, f: 0 }],
      f: (x, y) => 1 + (x * x + y * y) / 4000 - Math.cos(x) * Math.cos(y / Math.SQRT2),
    },
  };
  FUNCIONES.picos = {
    nombre: 'Picos (máximo)',
    objetivo: 'max',
    formula: 'f(x,y) = 3(1−x)²·e^(−x²−(y+1)²) − 10(x/5 − x³ − y⁵)·e^(−x²−y²) − ⅓·e^(−(x+1)²−y²)',
    descripcion: 'Es un paisaje con varias montañas, y aquí buscamos la más alta, no el punto más bajo.',
    dominio: [-3, 3],
    optimos: [{ x: -0.009318, y: 1.581368, f: 8.10621359 }],
    f: (x, y) =>
      3 * Math.pow(1 - x, 2) * Math.exp(-x * x - Math.pow(y + 1, 2)) -
      10 * (x / 5 - Math.pow(x, 3) - Math.pow(y, 5)) * Math.exp(-x * x - y * y) -
      Math.exp(-Math.pow(x + 1, 2) - y * y) / 3,
  };

  for (const F of Object.values(FUNCIONES)) {
    F.objetivo = F.objetivo || 'min';
    F.optimo = F.optimos[0];
  }

  /** Los tres escenarios de la diapositiva "Los parámetros controlan el carácter". */
  const ESCENARIOS = {
    A: { nombre: 'Exploración', w: 1.05, c1: 2.5, c2: 0.5 },
    B: { nombre: 'Equilibrio', w: 0.7, c1: 1.5, c2: 1.5 },
    C: { nombre: 'Concentración prematura', w: 0.3, c1: 0.5, c2: 2.5 },
  };

  const OPCIONES_POR_DEFECTO = {
    funcion: 'rastrigin',
    n: 30,
    w: 0.7,
    c1: 1.5,
    c2: 1.5,
    maxIter: 100,
    semilla: 7,
    decaimiento: false, // si es true, w baja linealmente de wInicial a wFinal
    wInicial: 0.9,
    wFinal: 0.4,
    vmaxFraccion: 0.2, // velocidad máxima como fracción del ancho del dominio
  };

  class Enjambre {
    constructor(opciones = {}) {
      const o = Object.assign({}, OPCIONES_POR_DEFECTO, opciones);
      const funcion = FUNCIONES[o.funcion];
      if (!funcion) throw new Error('Función desconocida: ' + o.funcion);

      this.clave = o.funcion;
      this.funcion = funcion;
      this.n = o.n;
      this.w = o.w;
      this.c1 = o.c1;
      this.c2 = o.c2;
      this.maxIter = o.maxIter;
      this.semilla = o.semilla;
      this.decaimiento = o.decaimiento;
      this.wInicial = o.wInicial;
      this.wFinal = o.wFinal;

      const [min, max] = funcion.dominio;
      this.min = min;
      this.max = max;
      this.vmax = o.vmaxFraccion * (max - min);

      // Para maximizar se usa la misma regla de PSO, solo cambia qué se considera "mejor".
      this.maximizar = funcion.objetivo === 'max';

      this.rng = crearRng(o.semilla);
      this.iteracion = 0;
      this.evaluaciones = 0;
      this.gBest = { x: 0, y: 0, f: this.maximizar ? -Infinity : Infinity };
      this.particulas = [];

      // 1. Inicio: posiciones aleatorias sobre todo el dominio.
      for (let i = 0; i < this.n; i++) {
        const x = this.aleatorio(min, max);
        const y = this.aleatorio(min, max);
        const vx = this.aleatorio(-0.5, 0.5) * this.vmax;
        const vy = this.aleatorio(-0.5, 0.5) * this.vmax;
        const f = this.evaluar(x, y);
        this.particulas.push({
          id: i,
          x,
          y,
          vx,
          vy,
          f,
          pBest: { x, y, f },
          previo: { x, y },
          fuerzas: null,
        });
        if (this.esMejor(f, this.gBest.f)) this.gBest = { x, y, f };
      }

      this.historial = [{ iteracion: 0, gBest: this.gBest.f, x: this.gBest.x, y: this.gBest.y, promedio: this.promedio() }];
    }

    aleatorio(a, b) {
      return a + this.rng() * (b - a);
    }

    /** true si el valor a es mejor que b (menor al minimizar, mayor al maximizar). */
    esMejor(a, b) {
      return this.maximizar ? a > b : a < b;
    }

    evaluar(x, y) {
      this.evaluaciones++;
      return this.funcion.f(x, y);
    }

    promedio() {
      let suma = 0;
      for (const p of this.particulas) suma += p.f;
      return suma / this.particulas.length;
    }

    /** Peso de inercia de la iteración actual (constante o con decaimiento lineal). */
    inerciaActual() {
      if (!this.decaimiento) return this.w;
      const t = Math.min(1, this.iteracion / this.maxIter);
      return this.wInicial - (this.wInicial - this.wFinal) * t;
    }

    get terminado() {
      return this.iteracion >= this.maxIter;
    }

    /**
     * 2. Búsqueda: una iteración completa.
     *   v(t+1) = w·v(t) + c1·r1·(pBest − x(t)) + c2·r2·(gBest − x(t))
     *   x(t+1) = x(t) + v(t+1)
     * Guarda las tres componentes de cada partícula para poder dibujarlas.
     */
    paso() {
      if (this.terminado) return false;

      const w = this.inerciaActual();
      const g = { x: this.gBest.x, y: this.gBest.y };

      for (const p of this.particulas) {
        const r1x = this.rng();
        const r1y = this.rng();
        const r2x = this.rng();
        const r2y = this.rng();

        const inercia = { x: w * p.vx, y: w * p.vy };
        const cognitiva = { x: this.c1 * r1x * (p.pBest.x - p.x), y: this.c1 * r1y * (p.pBest.y - p.y) };
        const social = { x: this.c2 * r2x * (g.x - p.x), y: this.c2 * r2y * (g.y - p.y) };

        let vx = inercia.x + cognitiva.x + social.x;
        let vy = inercia.y + cognitiva.y + social.y;

        // Límite de velocidad: evita que el enjambre "explote" con valores altos de w.
        const rapidez = Math.hypot(vx, vy);
        const limitada = rapidez > this.vmax;
        if (limitada) {
          vx *= this.vmax / rapidez;
          vy *= this.vmax / rapidez;
        }

        p.previo = { x: p.x, y: p.y };
        p.fuerzas = { w, inercia, cognitiva, social, limitada, fAntes: p.f, pBest: { x: p.pBest.x, y: p.pBest.y }, gBest: g };

        // Si se sale del dominio, se queda en el borde y pierde esa componente de velocidad.
        let nx = p.x + vx;
        let ny = p.y + vy;
        if (nx < this.min) { nx = this.min; vx = 0; }
        if (nx > this.max) { nx = this.max; vx = 0; }
        if (ny < this.min) { ny = this.min; vy = 0; }
        if (ny > this.max) { ny = this.max; vy = 0; }

        p.x = nx;
        p.y = ny;
        p.vx = vx;
        p.vy = vy;
        p.f = this.evaluar(nx, ny);
        if (this.esMejor(p.f, p.pBest.f)) p.pBest = { x: nx, y: ny, f: p.f };
      }

      // El mejor global se actualiza al final de la iteración (versión síncrona).
      for (const p of this.particulas) {
        if (this.esMejor(p.pBest.f, this.gBest.f)) this.gBest = { x: p.pBest.x, y: p.pBest.y, f: p.pBest.f };
      }

      this.iteracion++;
      this.historial.push({ iteracion: this.iteracion, gBest: this.gBest.f, x: this.gBest.x, y: this.gBest.y, promedio: this.promedio() });
      return true;
    }

    /** 3. Resultado: corre todas las iteraciones que falten. */
    ejecutar() {
      while (this.paso()) {
        // sigue hasta maxIter
      }
      return this.gBest;
    }
  }

  return { Enjambre, FUNCIONES, ESCENARIOS, crearRng };
});
