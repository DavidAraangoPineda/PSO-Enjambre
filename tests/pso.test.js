// Pruebas del algoritmo. Ejecutar con: node --test tests
const test = require('node:test');
const assert = require('node:assert/strict');
const { Enjambre, ESCENARIOS, FUNCIONES, fijarObjetivo } = require('../js/pso.js');

/** Mejor valor en una rejilla fina (para comprobar que el óptimo guardado es el global). */
function mejorEnRejilla(F, signo, n = 600) {
  const [a, b] = F.dominio;
  let mejor = -Infinity;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const v = signo * F.f(a + ((b - a) * i) / n, a + ((b - a) * j) / n);
      if (v > mejor) mejor = v;
    }
  }
  return signo * mejor;
}

test('la cordillera tiene bien guardados su máximo y su mínimo globales', () => {
  const F = FUNCIONES.cordillera;
  for (const [objetivo, signo] of [['max', 1], ['min', -1]]) {
    assert.ok(fijarObjetivo('cordillera', objetivo));
    assert.equal(F.objetivo, objetivo);
    const enRejilla = mejorEnRejilla(F, signo);
    // Ningún punto de la rejilla supera al óptimo guardado.
    assert.ok(signo * F.optimo.f >= signo * enRejilla - 1e-9, `${objetivo}: guardado ${F.optimo.f}, rejilla ${enRejilla}`);
  }
  fijarObjetivo('cordillera', 'max');
});

test('datos de la explicación de límites: la semilla 7 cae en una trampa y la semilla guardada acierta', () => {
  const F = FUNCIONES.cordillera;
  for (const objetivo of ['max', 'min']) {
    fijarObjetivo('cordillera', objetivo);
    const llega = (g) => Math.hypot(g.x - F.optimo.x, g.y - F.optimo.y) < 0.05;
    const falla = new Enjambre({ ...ESCENARIOS.B, funcion: 'cordillera', semilla: 7 }).ejecutar();
    assert.ok(!llega(falla), `${objetivo}: la semilla 7 no debería llegar`);
    const enTrampa = F.trampas.some((t) => Math.hypot(falla.x - t.x, falla.y - t.y) < 0.2);
    assert.ok(enTrampa, `${objetivo}: la semilla 7 terminó en (${falla.x}, ${falla.y}), que no es una trampa`);
    const acierta = new Enjambre({ ...ESCENARIOS.B, funcion: 'cordillera', semilla: F.semillaQueAcierta }).ejecutar();
    assert.ok(llega(acierta), `${objetivo}: la semilla ${F.semillaQueAcierta} debería llegar`);
  }
  fijarObjetivo('cordillera', 'max');
});

test('fijarObjetivo solo acepta funciones que permiten elegir', () => {
  assert.equal(fijarObjetivo('rastrigin', 'max'), false);
  assert.equal(FUNCIONES.rastrigin.objetivo, 'min');
  assert.equal(fijarObjetivo('cordillera', 'otro'), false);
});

test('en la cordillera el enjambre maximiza o minimiza según el objetivo', () => {
  for (const [objetivo, mejora] of [['max', (a, b) => a >= b], ['min', (a, b) => a <= b]]) {
    fijarObjetivo('cordillera', objetivo);
    const e = new Enjambre({ funcion: 'cordillera', semilla: 3 });
    e.ejecutar();
    for (let i = 1; i < e.historial.length; i++) assert.ok(mejora(e.historial[i].gBest, e.historial[i - 1].gBest));
  }
  fijarObjetivo('cordillera', 'max');
});

test('cada función alcanza su valor óptimo en sus óptimos globales', () => {
  for (const [clave, F] of Object.entries(FUNCIONES)) {
    for (const m of F.optimos) {
      assert.ok(Math.abs(F.f(m.x, m.y) - m.f) < 1e-5, `${clave} en (${m.x}, ${m.y}) vale ${F.f(m.x, m.y)}`);
    }
  }
});

test('en Himmelblau el enjambre termina en alguno de los cuatro mínimos', () => {
  const F = FUNCIONES.himmelblau;
  for (let s = 1; s <= 10; s++) {
    const g = new Enjambre({ funcion: 'himmelblau', semilla: s }).ejecutar();
    const distancia = Math.min(...F.optimos.map((m) => Math.hypot(g.x - m.x, g.y - m.y)));
    assert.ok(distancia < 0.01, `semilla ${s}: (${g.x}, ${g.y})`);
  }
});

test('guarda el valor de f antes de cada salto', () => {
  const e = new Enjambre({ semilla: 4 });
  const antes = e.particulas.map((p) => p.f);
  e.paso();
  e.particulas.forEach((p, i) => assert.equal(p.fuerzas.fAntes, antes[i]));
});

test('la misma semilla produce exactamente la misma corrida', () => {
  const a = new Enjambre({ semilla: 42 }).ejecutar();
  const b = new Enjambre({ semilla: 42 }).ejecutar();
  assert.deepEqual(a, b);
});

test('converge al mínimo de la esfera', () => {
  const g = new Enjambre({ funcion: 'esfera', semilla: 3 }).ejecutar();
  assert.ok(g.f < 1e-6, `f final ${g.f}`);
  assert.ok(Math.hypot(g.x, g.y) < 1e-3);
});

test('el gBest nunca empeora entre iteraciones', () => {
  const e = new Enjambre({ semilla: 11 });
  e.ejecutar();
  for (let i = 1; i < e.historial.length; i++) {
    assert.ok(e.historial[i].gBest <= e.historial[i - 1].gBest);
  }
});

test('las partículas se quedan dentro del dominio y respetan la velocidad máxima', () => {
  const e = new Enjambre({ ...ESCENARIOS.A, semilla: 5 });
  while (e.paso()) {
    for (const p of e.particulas) {
      assert.ok(p.x >= e.min && p.x <= e.max && p.y >= e.min && p.y <= e.max);
      assert.ok(Math.hypot(p.vx, p.vy) <= e.vmax + 1e-12);
    }
  }
});

test('hace n evaluaciones al inicio y n por cada iteración', () => {
  const e = new Enjambre({ n: 30, maxIter: 100, semilla: 1 });
  e.ejecutar();
  assert.equal(e.evaluaciones, 30 + 30 * 100);
});

test('el decaimiento lleva w de 0.9 a 0.4', () => {
  const e = new Enjambre({ decaimiento: true });
  assert.equal(e.inerciaActual(), 0.9);
  e.ejecutar();
  assert.ok(Math.abs(e.inerciaActual() - 0.4) < 1e-12);
});

test('las tres componentes suman la velocidad antes del límite', () => {
  const e = new Enjambre({ semilla: 9 });
  e.paso();
  for (const p of e.particulas) {
    const { inercia, cognitiva, social } = p.fuerzas;
    const sx = inercia.x + cognitiva.x + social.x;
    const sy = inercia.y + cognitiva.y + social.y;
    if (Math.hypot(sx, sy) <= e.vmax) {
      assert.ok(Math.abs(sx - p.vx) < 1e-12 || p.vx === 0);
      assert.ok(Math.abs(sy - p.vy) < 1e-12 || p.vy === 0);
    }
  }
});

test('en Rastrigin, el escenario B termina mejor que el C en promedio', () => {
  const corridas = 40;
  let sumaB = 0;
  let sumaC = 0;
  for (let s = 1; s <= corridas; s++) {
    sumaB += new Enjambre({ ...ESCENARIOS.B, semilla: s }).ejecutar().f;
    sumaC += new Enjambre({ ...ESCENARIOS.C, semilla: s }).ejecutar().f;
  }
  assert.ok(sumaB / corridas < sumaC / corridas, `B=${sumaB / corridas} C=${sumaC / corridas}`);
});

test('en Picos el enjambre busca el máximo y lo encuentra', () => {
  const F = FUNCIONES.picos;
  assert.equal(F.objetivo, 'max');
  let llegaron = 0;
  for (let s = 1; s <= 20; s++) {
    const e = new Enjambre({ funcion: 'picos', semilla: s });
    e.ejecutar();
    // Al maximizar, el gBest nunca baja.
    for (let i = 1; i < e.historial.length; i++) assert.ok(e.historial[i].gBest >= e.historial[i - 1].gBest);
    if (Math.hypot(e.gBest.x - F.optimo.x, e.gBest.y - F.optimo.y) < 0.01) llegaron++;
  }
  assert.ok(llegaron >= 15, `llegaron ${llegaron} de 20`);
});