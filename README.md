# Enjambre de Partículas (PSO)

Simulador interactivo de la Optimización por Enjambre de Partículas para acompañar la presentación.

## Cómo abrirlo

Doble clic en `index.html`. Se abre en el navegador y funciona sin internet ni instalaciones.

Para la exposición, presione `F` y queda en pantalla completa.

**Para la voz narradora, use Microsoft Edge con internet:** ofrece voces neuronales latinoamericanas y el simulador elige automáticamente una colombiana (Salomé). Sin internet o en otro navegador se usa la mejor voz en español disponible, y si no hay ninguna la explicación queda solo con subtítulos.

## Sonido

- **Voz narradora:** lee la explicación. Cada escena espera a que la voz termine.
- **Música de fondo:** se genera en el navegador, sin archivos. Suena solo mientras la simulación se mueve y se apaga en pausa, para no tapar al expositor. Se intensifica cuando la animación acelera y se apaga en la cámara lenta.
- **Efectos:** campana cada vez que mejora el gBest (más aguda en cada mejora), destellos al aparecer las partículas, barridos en las transiciones y acorde final.

Todo se controla en el panel "Sonido", donde también se puede cambiar de voz y probarla. La tecla `M` silencia todo. Los navegadores solo permiten sonido después del primer clic o tecla.

La voz predeterminada es siempre la de Edge (Salomé, Colombia). Con el primer clic o tecla, el simulador comprueba en silencio que responda. Si no responde (por ejemplo, sin internet o con una VPN o antivirus que bloquea el servicio), aparece un aviso en pantalla, "La voz de Edge no está disponible ahora", y se cambia sola a una voz instalada en el equipo. Si la página se abre en otro navegador, el aviso dice que la voz de Edge no está disponible en ese navegador.

Para tener una voz latinoamericana de respaldo que funcione sin internet, instale en Windows: Configuración → Hora e idioma → Voz → Agregar voces → Español (México). Para revisar qué pasó con la voz, escriba `Sonido.registro` en la consola del navegador (F12).

## Explicación por capítulos

La explicación narrada tiene 4 capítulos. Con `Av Pág` se reproduce el siguiente y con `Re Pág` el anterior; son las teclas que envían los presentadores inalámbricos. También hay botones del 1 al 4 en el panel. Al terminar cada capítulo, la escena se queda quieta con el aviso "Av Pág: siguiente capítulo", para que el expositor hable lo que necesite. `H` reproduce los 4 de corrido.

| Capítulo | Qué muestra |
|---|---|
| 1. El terreno | El terreno vacío, la función en 3D grande y la regla "mientras más bajo, mejor" (se dice una sola vez) |
| 2. Dónde empiezan | El borde del dominio se ilumina y las partículas caen una por una en puntos al azar. Una muestra sus coordenadas y su velocidad inicial, y se explica la semilla. Luego cada una calcula f y se elige el gBest |
| 3. Las fuerzas | Dos iteraciones lentas y luego cámara lenta sobre una partícula: inercia, cognitiva y social, con el valor de f en cada paso (verde si mejora, salmón si empeora) |
| 4. Todas a la vez | El enjambre completo, acelerando con la cámara hasta el resultado final |

**Modo cine:** al iniciar la explicación se ocultan los controles y el mapa, el 3D y el corte ocupan toda la pantalla. `Esc` o un clic vuelven a mostrar los controles. Se puede desactivar en "Qué mostrar".

**Final:** el capítulo 4 cierra con un plano centrado en el gBest y luego la cámara retrocede para dibujar el camino que recorrió el gBest desde el inicio, junto a una tarjeta con el resultado (iteraciones, evaluaciones, mejor f y si encontró el óptimo global).

**Posiciones iniciales:** cada partícula empieza en un punto al azar uniforme dentro del dominio (en Rastrigin, x e y entre −5.12 y 5.12), con una velocidad inicial pequeña también al azar (hasta el 10 % del ancho del dominio en cada eje). El azar usa una semilla, así que la misma semilla repite la misma corrida.

## Controles con el mouse

| Dónde | Acción | Qué hace |
|---|---|---|
| Mapa | Rueda | Acerca o aleja, dejando quieto el punto bajo el cursor |
| Mapa | Arrastrar | Desplaza la vista |
| Mapa | Doble clic | Vuelve a la cámara automática |
| Mapa | Clic en una partícula | Muestra sus fuerzas |
| 3D | Arrastrar | Gira e inclina la superficie |
| 3D | Rueda | Acerca o aleja |
| 3D | Doble clic | Vuelve al giro automático |
| 3D | Botón Ampliar o tecla `D` | Abre el 3D en grande; ahí también se puede girar |

Las partículas se siguen moviendo mientras se gira el 3D. El zoom y el arrastre del mapa funcionan en la simulación libre; la narración y el reto manejan su propia cámara.

## Efectos con la tarjeta gráfica

- **Partículas dentro del 3D:** se dibujan en la misma escena que la superficie, así que si quedan detrás de una montaña, la montaña las tapa.
- **Resplandor:** las partículas y el gBest tienen un brillo que se suma sobre el mapa y sobre el 3D.
- **Relieve en el mapa:** el mapa se sombrea según la pendiente, con una luz lateral, para que los pozos se lean sin mirar el 3D. Se apaga en "Qué mostrar".
- **Mapa de exploración (`X`):** lo que el enjambre visitó queda en color y lo que nunca miró, en gris. Se ve mejor con la vista completa del terreno. La explicación narrada lo muestra al final del capítulo 4.
- **Bandada gigante (`B` o el botón bajo los escenarios):** 2.000 partículas en vez de 30, con la misma regla de PSO. Con la bandada no se dibujan estelas, y el reto vuelve solo a un enjambre normal.

## Usarlo en otro computador

1. Copie la carpeta `PSO-Enjambre` completa (por ejemplo, en una memoria USB o comprimida en un .zip). Son solo archivos HTML, CSS y JavaScript: no hay que instalar nada.
2. En el otro computador, abra `index.html` con **Microsoft Edge** (clic derecho → Abrir con → Microsoft Edge).
3. Para la voz natural (Salomé), ese computador necesita **internet**. Sin internet se usa la voz instalada en Windows o solo subtítulos; todo lo demás funciona igual.
4. Antes de presentar, presione una tecla cualquiera (el simulador prueba la voz en silencio) y luego `F` para pantalla completa.

Si el otro computador no tiene tarjeta gráfica compatible con WebGL, el simulador usa solo el dibujo por procesador: funciona, pero más lento y sin los efectos de la tarjeta gráfica (resplandor, relieve, exploración, partículas tapadas por el terreno). Para comprobarlo, escriba `__mapaGL` en la consola (F12): `true` significa que usa la tarjeta gráfica.

## Rendimiento

El mapa y la superficie 3D los dibuja la tarjeta gráfica (WebGL, en `js/mapa-gl.js`): la función se evalúa en cada píxel del mapa y en cada vértice de la superficie, así que se ven nítidos a cualquier zoom y sin tirones. Encima, en lienzos transparentes, se dibujan las partículas, las flechas y los rótulos.

Medido en Edge con una GTX 1060, con la simulación corriendo y la cámara haciendo zoom:

| | Antes (todo por procesador) | Ahora |
|---|---|---|
| Cuadros por segundo | 41,7 | 60 |
| Cuadros lentos (más de 33 ms) en 12 s | 206 | 0 |
| Peor cuadro | 117 ms | 17 ms |
| Tiempo de código por cuadro | — | 2,6 ms |
| Bandada de 2.000 partículas | — | 60 cuadros por segundo |

Si el equipo no tiene WebGL, se usa automáticamente el dibujo por procesador. Para ver los tiempos, escriba `__rendimiento` en la consola del navegador (F12).

## Qué tiene

- **Seis funciones:** Rastrigin, Ackley, Himmelblau (cuatro mínimos globales), Griewank (muchos pozos casi igual de profundos), Esfera y **Picos, donde se busca el máximo**. Se eligen en el panel o abriendo `index.html?funcion=himmelblau` (o `picos`, `griewank`, etc.).
- **Buscar el máximo:** en Picos el enjambre busca la montaña más alta. El algoritmo es el mismo; solo cambia qué se considera "mejor". El mapa muestra las zonas altas en claro, el 3D muestra montañas y la narración dice "mientras más alto, mejor".
- **El 3D en grande:** al presentar la función (en la narración o al cambiarla en el panel), la superficie aparece en grande sobre el mapa unos segundos con su nombre y su fórmula, y luego se encoge.
- **La función en 3D:** a la derecha del mapa, la misma zona como superficie, con las partículas posadas encima. Si la cámara hace zoom, el 3D también. La altura es log(1 + f), para que se vean los pozos pequeños.
- **Corte de la función:** una gráfica de f a lo largo de una línea. Normalmente es el corte horizontal que pasa por el gBest. Al ver las fuerzas de una partícula muestra el recorrido del salto: cuánto vale f al sumar la inercia, luego la cognitiva y luego la social.
- **Fórmula con números:** la función con los valores reemplazados en el gBest o en la partícula seleccionada.
- La columna 3D se oculta con `G` y desaparece sola en el reto, porque revelaría el terreno.

- **Explicación narrada (`H`):** una secuencia automática de poco más de un minuto, con subtítulos, al estilo de un video. Presenta el terreno, muestra cuánto vale f en cada partícula, elige el gBest, sigue a una partícula en cámara lenta mientras aparecen sus tres fuerzas una por una, y termina acelerando con la cámara acercándose al mínimo. Cualquier clic o tecla la detiene, excepto `F`.
- **Cámara que sigue al enjambre:** hace zoom a medida que las partículas se juntan, para que se siga viendo el movimiento cuando ya están cerca del mínimo. El mapa se recalcula para la zona visible, con curvas de nivel como un mapa topográfico. Se activa o desactiva con `C`.
- **Efectos:** las partículas aparecen con un rebote al reiniciar, y cada vez que mejora el gBest sale una onda y el aviso "¡Nuevo mejor global!".
- **Simulación:** 30 partículas sobre la función de Rastrigin, con w = 0.7, c₁ = 1.5, c₂ = 1.5 y 100 iteraciones, como en la diapositiva del experimento. El mapa muestra la función: las zonas oscuras son las de menor valor.
- **Fuerzas:** al hacer clic sobre una partícula aparecen sus tres componentes como flechas encadenadas: inercia (azul), cognitiva (verde) y social (salmón). La flecha blanca es el salto que realmente dio.
- **Escenarios A, B y C:** los tres casos de la diapositiva de parámetros, con la misma semilla para compararlos en igualdad de condiciones.
- **Tú vs. el enjambre:** el mapa está oculto y el público tiene 10 clics para buscar el punto más bajo. Después se suelta el enjambre, que va descubriendo el terreno mientras busca.
- **Gráfica de convergencia:** la distancia al óptimo |f − f*| del gBest y del promedio del enjambre, en escala logarítmica. Funciona igual al buscar mínimos o máximos.
- **Narración con comparaciones:** cada vez que dice un valor de f, aclara si es más bajo o más alto que antes y si eso es mejor o peor.

## Atajos de teclado

| Tecla | Acción |
|---|---|
| `H` | Explicación narrada completa |
| `Av Pág` / `Re Pág` | Siguiente / anterior capítulo de la explicación |
| `Espacio` | Iniciar o pausar |
| `N` o `→` | Avanzar una iteración |
| `R` | Reiniciar |
| `1` `2` `3` | Escenarios A, B y C |
| `C` | Activar o desactivar la cámara que sigue al enjambre |
| `G` | Mostrar u ocultar la vista 3D y el corte |
| `D` | Abrir o cerrar el 3D grande |
| `X` | Mapa de exploración |
| `B` | Bandada gigante (2.000 partículas) |
| `V` | Mostrar u ocultar las fuerzas |
| `T` | Mostrar u ocultar las estelas |
| `J` | Cambiar entre simulación y reto |
| `M` | Silenciar o activar el sonido |
| `F` | Pantalla completa |

## Guion sugerido para la presentación

| Diapositiva | Qué hacer en el simulador |
|---|---|
| 5. Cada partícula combina memoria y contexto | Activar "pBest de cada partícula" y señalar el gBest que palpita |
| 6. La velocidad nace de tres fuerzas | Pausar al inicio, avanzar con `N` y hacer clic en una partícula para ver sus tres flechas |
| 7. La posición se actualiza paso a paso | Seguir avanzando con `N`: la flecha blanca es x(t+1) − x(t) |
| 8. Los parámetros controlan el carácter | Presionar `1`, `2` y `3` y comparar cómo se mueve el enjambre |
| 10. ¿Puede un enjambre encontrar el mínimo? | Presionar `H` y dejar correr la explicación narrada, o `R` y `Espacio` para el experimento sin narración |
| 11. Mínimos locales y globales | Presionar `3`: el enjambre suele quedarse en un pozo que no es el mínimo global |
| 14. Cierre | Modo "Tú vs. el enjambre" con alguien del público |

## Resultados de referencia

Corriendo 40 semillas distintas sobre Rastrigin, con 30 partículas y 100 iteraciones:

| Escenario | Parámetros | f final promedio | Llegaron al mínimo global (f < 0.01) |
|---|---|---|---|
| A. Exploración | w = 1.05, c₁ = 2.5, c₂ = 0.5 | 0.1476 | 7 de 40 |
| B. Equilibrio | w = 0.7, c₁ = 1.5, c₂ = 1.5 | 0.0498 | 38 de 40 |
| C. Concentración prematura | w = 0.3, c₁ = 0.5, c₂ = 2.5 | 0.6716 | 16 de 40 |

## Detalles del algoritmo

El algoritmo está en `js/pso.js`, separado del dibujo:

- Velocidad: v(t+1) = w·v(t) + c₁r₁(pBest − x(t)) + c₂r₂(gBest − x(t)), con r₁ y r₂ aleatorios por cada coordenada.
- Posición: x(t+1) = x(t) + v(t+1).
- La velocidad se limita a vmax = 20 % del ancho del dominio. Sin ese límite, el escenario A hace que las partículas salgan disparadas.
- Si una partícula se sale del dominio, se queda en el borde y pierde esa componente de la velocidad.
- El gBest se actualiza al final de cada iteración.
- Con la misma semilla se repite exactamente la misma corrida.

## Pruebas

Con Node.js instalado:

```powershell
node --test tests/pso.test.js
```
