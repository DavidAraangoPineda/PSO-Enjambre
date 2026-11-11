/*
 * Sonido del simulador, sin archivos externos:
 *  - Música de fondo generada con Web Audio (acordes La menor, Fa, Do, Sol) que
 *    se intensifica con la animación y se apaga cuando la simulación está en pausa.
 *  - Efectos cortos (nuevo mejor global, aparición, transiciones, final).
 *  - Voz narradora con la síntesis de voz del navegador (speechSynthesis).
 *
 * Los navegadores solo permiten sonido después de un clic o una tecla, así que
 * nada suena hasta la primera interacción.
 */
(function () {
  'use strict';

  const Sonido = {};
  const prefs = { voz: true, musica: true, efectos: true, volumen: 0.8 };

  let ac = null;
  let master;
  let busMusica;
  let busEfectos;
  let filtroMusica;
  let ruido;
  let musicaActiva = false;
  let intensidad = 0;
  let lento = false;
  let atenuada = false;
  let siguienteCompas = 0;
  let compas = 0;

  const DUR_COMPAS = 2.4; // segundos (100 pulsos por minuto, 4 pulsos)
  const ACORDES = [
    [220.0, 261.63, 329.63], // La menor
    [174.61, 220.0, 261.63], // Fa
    [261.63, 329.63, 392.0], // Do
    [196.0, 246.94, 293.66], // Sol
  ];
  const BAJOS = [110.0, 87.31, 130.81, 98.0];
  // Escala pentatónica de La menor, de grave a agudo: cada mejora suena un poco más arriba.
  const ESCALA = [220, 261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51, 1567.98];

  // ---------------------------------------------------------------- motor

  function asegurar() {
    if (!ac) {
      const Contexto = window.AudioContext || window.webkitAudioContext;
      if (!Contexto) return false;
      ac = new Contexto();

      const compresor = ac.createDynamicsCompressor();
      compresor.connect(ac.destination);
      master = ac.createGain();
      master.gain.value = prefs.volumen;
      master.connect(compresor);

      const reverb = ac.createConvolver();
      reverb.buffer = crearImpulso(3.2);
      const envioReverb = ac.createGain();
      envioReverb.gain.value = 0.35;
      reverb.connect(envioReverb);
      envioReverb.connect(master);

      filtroMusica = ac.createBiquadFilter();
      filtroMusica.type = 'lowpass';
      filtroMusica.frequency.value = 900;
      filtroMusica.Q.value = 0.7;
      busMusica = ac.createGain();
      busMusica.gain.value = 0;
      filtroMusica.connect(busMusica);
      busMusica.connect(master);
      busMusica.connect(reverb);

      busEfectos = ac.createGain();
      busEfectos.gain.value = prefs.efectos ? 0.9 : 0;
      busEfectos.connect(master);
      busEfectos.connect(reverb);

      ruido = crearRuido(1.5);
      setInterval(programar, 100);
    }
    if (ac.state === 'suspended') ac.resume();
    return true;
  }

  function listo() {
    return ac && ac.state === 'running';
  }

  function crearImpulso(segundos) {
    const largo = Math.floor(ac.sampleRate * segundos);
    const buffer = ac.createBuffer(2, largo, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const datos = buffer.getChannelData(c);
      for (let i = 0; i < largo; i++) datos[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / largo, 3);
    }
    return buffer;
  }

  function crearRuido(segundos) {
    const largo = Math.floor(ac.sampleRate * segundos);
    const buffer = ac.createBuffer(1, largo, ac.sampleRate);
    const datos = buffer.getChannelData(0);
    for (let i = 0; i < largo; i++) datos[i] = Math.random() * 2 - 1;
    return buffer;
  }

  function envolvente(nodo, t0, ataque, pico, caida) {
    nodo.gain.setValueAtTime(0.0001, t0);
    nodo.gain.exponentialRampToValueAtTime(pico, t0 + ataque);
    nodo.gain.exponentialRampToValueAtTime(0.0001, t0 + ataque + caida);
  }

  function tono(destino, tipo, frecuencia, t0, ataque, pico, caida, desafinar = 0) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = tipo;
    o.frequency.value = frecuencia;
    o.detune.value = desafinar;
    envolvente(g, t0, ataque, pico, caida);
    o.connect(g);
    g.connect(destino);
    o.start(t0);
    o.stop(t0 + ataque + caida + 0.05);
    return o;
  }

  // ---------------------------------------------------------------- música

  function programar() {
    if (!listo()) return;
    const ahora = ac.currentTime;
    if (!musicaActiva && busMusica.gain.value < 0.002) {
      siguienteCompas = 0;
      return;
    }
    if (siguienteCompas < ahora) siguienteCompas = ahora + 0.05;
    while (siguienteCompas < ahora + 0.6) {
      tocarCompas(siguienteCompas, compas);
      siguienteCompas += DUR_COMPAS;
      compas++;
    }
  }

  function tocarCompas(t0, n) {
    const indice = Math.floor(n / 2) % ACORDES.length;
    const acorde = ACORDES[indice];

    // Colchón de acordes y bajo: cambian cada dos compases.
    if (n % 2 === 0) {
      const duracion = DUR_COMPAS * 2;
      for (const f of acorde) {
        tono(filtroMusica, 'sawtooth', f, t0, 1.2, 0.03, duracion, -7);
        tono(filtroMusica, 'sawtooth', f, t0, 1.2, 0.03, duracion, 7);
      }
      tono(filtroMusica, 'sine', BAJOS[indice], t0, 0.4, 0.09, duracion);
    }

    // Arpegio cuando el enjambre se está moviendo.
    if (intensidad >= 0.35) {
      const patron = [0, 1, 2, 1, 0, 2, 1, 2];
      const paso = DUR_COMPAS / 8;
      patron.forEach((k, i) => {
        tono(filtroMusica, 'triangle', acorde[k] * 2, t0 + i * paso, 0.01, 0.035 + 0.02 * intensidad, 0.28);
      });
    }

    // Pulso de percusión cuando acelera.
    if (intensidad >= 0.75) {
      const pulso = DUR_COMPAS / 4;
      for (let b = 0; b < 4; b++) {
        if (b % 2 === 0 || intensidad >= 0.9) bombo(t0 + b * pulso);
        platillo(t0 + b * pulso + pulso / 2);
      }
    }
  }

  function bombo(t0) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.setValueAtTime(140, t0);
    o.frequency.exponentialRampToValueAtTime(45, t0 + 0.12);
    envolvente(g, t0, 0.005, 0.32, 0.25);
    o.connect(g);
    g.connect(busMusica);
    o.start(t0);
    o.stop(t0 + 0.3);
  }

  function platillo(t0) {
    const s = ac.createBufferSource();
    s.buffer = ruido;
    const f = ac.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 7000;
    const g = ac.createGain();
    envolvente(g, t0, 0.002, 0.035, 0.05);
    s.connect(f);
    f.connect(g);
    g.connect(busMusica);
    s.start(t0, Math.random());
    s.stop(t0 + 0.08);
  }

  function aplicarVolumenMusica() {
    if (!ac) return;
    const objetivo = musicaActiva && prefs.musica ? (atenuada ? 0.22 : 0.55) : 0;
    busMusica.gain.setTargetAtTime(objetivo, ac.currentTime, musicaActiva ? 0.6 : 0.8);
  }

  function aplicarFiltro() {
    if (!ac) return;
    const corte = lento ? 360 : 900 + 2600 * intensidad;
    filtroMusica.frequency.setTargetAtTime(corte, ac.currentTime, 0.4);
  }

  // ---------------------------------------------------------------- efectos

  function puedeEfecto() {
    return listo() && prefs.efectos;
  }

  /** Campana del nuevo mejor global; cada mejora suena un poco más aguda. */
  Sonido.mejora = function (nivel) {
    if (!puedeEfecto()) return;
    const f = ESCALA[Math.min(Math.max(0, nivel), ESCALA.length - 1)];
    const t0 = ac.currentTime + 0.01;
    tono(busEfectos, 'sine', f, t0, 0.004, 0.12, 0.9);
    tono(busEfectos, 'sine', f * 2.01, t0, 0.004, 0.04, 0.5);
  };

  /** Destellos ascendentes cuando aparecen las partículas. */
  Sonido.aparicion = function () {
    if (!puedeEfecto()) return;
    const t0 = ac.currentTime + 0.02;
    for (let i = 0; i < 12; i++) {
      const f = ESCALA[5 + Math.floor(Math.random() * 9)];
      tono(busEfectos, 'sine', f, t0 + i * 0.065, 0.003, 0.03, 0.35);
    }
  };

  /** Una gota de sonido por cada partícula que cae en su posición inicial. */
  Sonido.lluvia = function (n, msEntre) {
    if (!puedeEfecto()) return;
    const t0 = ac.currentTime + 0.05;
    for (let i = 0; i < n; i++) {
      const f = ESCALA[4 + Math.floor(Math.random() * 10)];
      tono(busEfectos, 'sine', f, t0 + (i * msEntre + 330) / 1000, 0.003, 0.05, 0.3);
    }
  };

  /** Barrido de aire para transiciones de cámara. */
  Sonido.barrido = function (subiendo = true) {
    if (!puedeEfecto()) return;
    const t0 = ac.currentTime + 0.01;
    const s = ac.createBufferSource();
    s.buffer = ruido;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.2;
    f.frequency.setValueAtTime(subiendo ? 300 : 2800, t0);
    f.frequency.exponentialRampToValueAtTime(subiendo ? 2800 : 250, t0 + 0.9);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
    s.connect(f);
    f.connect(g);
    g.connect(busEfectos);
    s.start(t0);
    s.stop(t0 + 1.05);
  };

  /** Golpe suave, por ejemplo al aparecer una flecha de fuerza. */
  Sonido.toque = function (nivel = 6) {
    if (!puedeEfecto()) return;
    const t0 = ac.currentTime + 0.01;
    const f = ESCALA[Math.min(nivel, ESCALA.length - 1)];
    tono(busEfectos, 'triangle', f, t0, 0.003, 0.08, 0.25);
  };

  /** Gota: el clic del público en el reto. */
  Sonido.gota = function () {
    if (!puedeEfecto()) return;
    const t0 = ac.currentTime + 0.01;
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.frequency.setValueAtTime(900, t0);
    o.frequency.exponentialRampToValueAtTime(320, t0 + 0.15);
    envolvente(g, t0, 0.003, 0.14, 0.22);
    o.connect(g);
    g.connect(busEfectos);
    o.start(t0);
    o.stop(t0 + 0.3);
  };

  /** Acorde final con campanas. */
  Sonido.final = function () {
    if (!puedeEfecto()) return;
    const t0 = ac.currentTime + 0.02;
    [440, 523.25, 659.25, 880, 1318.51].forEach((f, i) => {
      tono(busEfectos, 'sine', f, t0 + i * 0.09, 0.005, 0.09, 2.6);
      tono(busEfectos, 'triangle', f / 2, t0 + i * 0.09, 0.02, 0.03, 2.2);
    });
  };

  // ---------------------------------------------------------------- control de música

  Sonido.desbloquear = asegurar;

  Sonido.musicaActiva = function (activa) {
    if (activa === musicaActiva) return;
    musicaActiva = activa;
    aplicarVolumenMusica();
  };

  Sonido.intensidad = function (valor) {
    const nuevo = Math.max(0, Math.min(1, valor));
    if (nuevo === intensidad) return;
    intensidad = nuevo;
    aplicarFiltro();
  };

  Sonido.lento = function (activo) {
    lento = activo;
    aplicarFiltro();
  };

  Sonido.configurar = function (cambios) {
    Object.assign(prefs, cambios);
    if (ac) {
      master.gain.setTargetAtTime(prefs.volumen, ac.currentTime, 0.1);
      busEfectos.gain.setTargetAtTime(prefs.efectos ? 0.9 : 0, ac.currentTime, 0.1);
      aplicarVolumenMusica();
    }
    if (!prefs.voz) Sonido.callar();
  };

  Sonido.preferencias = () => ({ ...prefs });

  // ---------------------------------------------------------------- voz

  // Últimos eventos de la voz, para diagnosticar problemas (Sonido.registro en la consola).
  Sonido.registro = [];
  function anotar(evento) {
    Sonido.registro.push(`${(performance.now() / 1000).toFixed(1)}s ${evento}`);
    if (Sonido.registro.length > 60) Sonido.registro.shift();
  }

  let vozElegida = null;
  let fraseActual = null; // se guarda para que Chrome no la descarte antes de terminar

  function vocesEspanol() {
    if (!window.speechSynthesis) return [];
    return speechSynthesis.getVoices().filter((v) => /^es/i.test(v.lang));
  }

  // Prefiere las voces neuronales de Edge y, entre ellas, las latinoamericanas (primero Colombia).
  function region(v) {
    return (v.lang.split(/[-_]/)[1] || '').toUpperCase();
  }

  function esLatinoamericana(v) {
    return region(v) !== 'ES' && region(v) !== '';
  }

  function esDeEdge(v) {
    return /natural/i.test(v.name);
  }

  function puntaje(v) {
    let s = 0;
    if (esDeEdge(v)) s += 1000; // la voz de Edge siempre va primero
    if (region(v) === 'CO') s += 300;
    else if (esLatinoamericana(v)) s += 200;
    if (/online/i.test(v.name)) s += 40;
    if (/google/i.test(v.name)) s += 30;
    return s;
  }

  Sonido.esLatinoamericana = esLatinoamericana;
  Sonido.esDeEdge = esDeEdge;

  /** Nombre corto para mostrar: "Microsoft Salome Online (Natural) - Spanish (Colombia)" → "Salome". */
  Sonido.nombreCorto = function (v) {
    return v ? v.name.replace(/^Microsoft\s+/, '').replace(/\s+(Online|Desktop).*$/, '').replace(/\s+-\s+.*$/, '') : '';
  };

  Sonido.voces = function () {
    return vocesEspanol().sort((a, b) => puntaje(b) - puntaje(a));
  };

  // Voces que fallaron en esta sesión (por ejemplo, voces en línea sin respuesta del servidor).
  const vocesFallidas = new Set();
  let avisarCambioDeVoz = () => {};

  Sonido.elegirVoz = function (nombre) {
    vocesFallidas.delete(nombre); // si la eligen a mano, se le da otra oportunidad
    vozElegida = vocesEspanol().find((v) => v.name === nombre) || null;
  };

  /**
   * Voz que se usará. Si alguna falló, se pasa a las voces instaladas en el
   * equipo (localService), que no dependen de internet.
   */
  Sonido.vozActual = function () {
    if (vozElegida && !vocesFallidas.has(vozElegida.name)) return vozElegida;
    const disponibles = Sonido.voces().filter((v) => !vocesFallidas.has(v.name));
    if (vocesFallidas.size > 0) {
      const locales = disponibles.filter((v) => v.localService);
      if (locales.length) return locales[0];
    }
    return disponibles[0] || null;
  };

  /** Nombres de las voces que fallaron en esta sesión. */
  Sonido.vocesFallidas = () => [...vocesFallidas];

  Sonido.alCambiarVozActiva = function (accion) {
    avisarCambioDeVoz = accion;
  };

  function marcarFallida(voz, motivo) {
    if (!voz || vocesFallidas.has(voz.name)) return;
    vocesFallidas.add(voz.name);
    anotar(`voz descartada (${motivo}): ${voz.name}`);
    avisarCambioDeVoz(voz, Sonido.vozActual());
  }

  let pruebaHecha = false;

  /**
   * Prueba en silencio si la voz elegida responde, antes de que empiece la narración.
   * Solo hace falta con las voces en línea; las instaladas en el equipo no fallan así.
   * Necesita una interacción del usuario (clic o tecla), por eso se llama al desbloquear.
   */
  Sonido.probarVoz = function () {
    const voz = Sonido.vozActual();
    if (pruebaHecha || !window.speechSynthesis || !voz || voz.localService || speechSynthesis.speaking) return;
    pruebaHecha = true;
    const frase = new SpeechSynthesisUtterance('Hola');
    frase.voice = voz;
    frase.lang = voz.lang;
    frase.volume = 0; // no se escucha
    let respondio = false;
    const vigilante = setTimeout(() => {
      if (!respondio && fraseActual === frase) {
        speechSynthesis.cancel();
        marcarFallida(voz, 'no respondió a la prueba');
      }
    }, 5000);
    frase.onstart = () => {
      respondio = true;
      clearTimeout(vigilante);
      anotar(`prueba correcta: ${voz.name}`);
    };
    frase.onerror = (ev) => {
      clearTimeout(vigilante);
      if (ev.error !== 'interrupted' && ev.error !== 'canceled') marcarFallida(voz, `prueba: ${ev.error}`);
    };
    fraseActual = frase;
    speechSynthesis.speak(frase);
  };

  Sonido.alCambiarVoces = function (accion) {
    if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', accion);
  };

  function atenuar(activo) {
    atenuada = activo;
    aplicarVolumenMusica();
  }

  /**
   * Lee el texto en voz alta. La promesa se resuelve con true si la frase se
   * escuchó completa, o con false si la voz está apagada, no hay voces en
   * español o el navegador no logró leerla.
   *
   * Problemas que se manejan:
   *  - La voz falla ("synthesis-failed") o no arranca en 4 segundos: suele pasar
   *    con las voces en línea de Edge cuando su servidor no responde. Esa voz se
   *    descarta y se repite la frase con una voz instalada en el equipo.
   *  - La frase se corta al primer segundo: se repite con la misma voz.
   */
  Sonido.decir = function (texto) {
    return new Promise((resolver) => {
      if (!prefs.voz || prefs.volumen <= 0 || !window.speechSynthesis || !Sonido.vozActual()) {
        resolver(false);
        return;
      }
      const duracionMinima = texto.length * 30; // ms; hablando de verdad tarda más del doble
      let terminado = false;
      let intentos = 0;
      let respaldo = null;
      let vigilante = null;

      const fin = (escuchada) => {
        if (terminado) return;
        terminado = true;
        clearTimeout(respaldo);
        clearTimeout(vigilante);
        atenuar(false);
        resolver(escuchada);
      };

      // Se reintenta con la voz que corresponda en ese momento (puede ser otra si la anterior falló).
      const reintentar = () => {
        if (intentos < 4 && Sonido.vozActual()) setTimeout(hablar, 150);
        else fin(false);
      };

      const hablar = () => {
        if (terminado) return;
        const voz = Sonido.vozActual();
        if (!voz) return fin(false);
        intentos++;
        speechSynthesis.cancel();
        const frase = new SpeechSynthesisUtterance(texto);
        frase.voice = voz;
        frase.lang = voz.lang;
        frase.rate = 1.02;
        frase.volume = Math.min(1, prefs.volumen + 0.2);
        fraseActual = frase;
        let inicio = 0;
        frase.onstart = () => {
          inicio = performance.now();
          clearTimeout(vigilante);
          anotar(`inicio intento ${intentos} (${voz.name}): ${texto.slice(0, 30)}`);
        };
        frase.onend = () => {
          const duro = inicio ? performance.now() - inicio : 0;
          anotar(`fin tras ${Math.round(duro)} ms (mínimo ${duracionMinima}) actual=${fraseActual === frase}`);
          if (fraseActual !== frase || terminado) return;
          if (duro >= duracionMinima) fin(true);
          else reintentar(); // se cortó antes de tiempo
        };
        frase.onerror = (ev) => {
          anotar(`error ${ev.error} (${voz.name}) actual=${fraseActual === frase}`);
          if (fraseActual !== frase || terminado) return;
          if (ev.error === 'interrupted' || ev.error === 'canceled') return fin(false);
          marcarFallida(voz, ev.error);
          reintentar();
        };
        // Un respiro después de cancel(): algunos navegadores descartan lo que se pide justo después.
        setTimeout(() => {
          if (terminado || fraseActual !== frase) return;
          speechSynthesis.resume();
          speechSynthesis.speak(frase);
        }, 80);
        // Si en 4 segundos no empezó a hablar, esa voz no está respondiendo.
        clearTimeout(vigilante);
        vigilante = setTimeout(() => {
          if (terminado || fraseActual !== frase || inicio) return;
          marcarFallida(voz, 'no arrancó');
          reintentar();
        }, 4000);
      };

      atenuar(true);
      // Respaldo por si el navegador nunca avisa que terminó.
      respaldo = setTimeout(() => fin(false), 12000 + texto.length * 130);
      hablar();
    });
  };

  Sonido.callar = function () {
    if (window.speechSynthesis) speechSynthesis.cancel();
    fraseActual = null;
    atenuar(false);
  };

  window.Sonido = Sonido;
})();
