# VOX Speak 3.0 — Laboratorio de benchmark fonético v0.3

**AISLADO:** Repositorio `freddih13-arch/vox-speak-v3-phoneme-lab`. Este proyecto no modifica `vox-speak-v3-staging/main` ni `vox-speak-free`.

## Qué responde este experimento

1. **Repetibilidad:** ejecutar el modelo Q4 **dos veces** sobre exactamente el mismo `Float32Array` de audio preparado a mono/16 kHz. Se compara la secuencia IPA byte por byte y se muestra una huella SHA-256 abreviada del audio PCM.
2. **Efecto de cuantización:** opcionalmente ejecutar el mismo PCM en `fp16` **en otro worker** y comparar su salida, latencia y distancia de tokens frente a una transcripción IPA de referencia aproximada.
3. **Control de audio:** el archivo `reference-espeak-en-us.wav` dice «I work in sales» y fue creado con `espeak -v en-us -s 142 -a 160`. **Es sintético, no una grabación humana nativa.** Este control permite detectar fallos básicos, pero NO valida una evaluación de pronunciación; un modelo entrenado en voz natural puede funcionar peor con eSpeak. Para una comparación con hablante nativo real, importar un archivo humano con frase/transcripción conocida y derechos de uso adecuados, sin subirlo a GitHub.

## Cómo ejecutar desde Android

1. Abrir `https://freddih13-arch.github.io/vox-speak-v3-phoneme-lab/` en Chrome y confirmar `BENCHMARK V0.3`.
2. Pulsar **Usar control sintético eSpeak (no nativo)**. Escucharlo primero. Selecciona alternativamente una nueva grabación propia o importa otro archivo humano de referencia.
3. **No activar FP16 en la primera pasada**. Pulsar **Analizar Q4 dos veces (mismo audio)**. El primer análisis descarga Q4 (~89,8 MB); el segundo reutiliza el worker y debe devolver la misma secuencia.
4. Copiar el reporte, que incluye secuencias IPA y distancias de edición sin calificar pronunciación.
5. Solo si Chrome tiene memoria/almacenamiento suficientes y estás en Wi-Fi, marcar FP16 (189 MB extra) y repetir el benchmark sobre el mismo archivo. El worker Q4 se destruye antes de crear el worker FP16 para reducir presión de memoria. Si FP16 falla, se registra explícitamente sin simular resultados.

## Interpretación

La **distancia de edición** es entre tokens IPA reconocidos por el modelo y una referencia fonética **aproximada** (en-US). No es un porcentaje de acierto ni diagnóstico del acento, ni valida una pronunciación correcta o incorrecta. Una muestra sintética **no reemplaza** una referencia humana. Comparar FP16 con Q4 separa efectos de cuantización, pero no demuestra validez frente a diferentes acentos.

- El modelo ONNX solo se descarga después de pulsar **Analizar**.
- La grabación se mantiene en memoria del navegador, jamás se sube a nuestro GitHub ni a Azure.
- La librería Transformers.js y los pesos se obtienen respectivamente de jsDelivr y Hugging Face al ejecutar la inferencia.
- Cada corrida se procesa en Web Worker y no hay almacenamiento persistente de audio personal.
- Sin Azure, sin API keys y sin puntuaciones fonéticas fabricadas.
- `fp16` está **sin validar en WASM de Chrome Android** y podría no funcionar o exceder RAM.

## Pruebas ejecutadas

```bash
node --test tests/*.test.mjs
```

29/29 pruebas de unidad e integración simulada completadas (incluye audio mono/16 kHz, CTC, carga diferida, selección FP16, edición y archivos HTML). El archivo WAV de referencia fue inspeccionado con el módulo `wave` de Python y contiene audio PCM mono válido de ~1,64 segundos.

**NO CONFIRMADO:** prueba del modelo FP16 real en Android, precisión frente a voz humana, y recorrido completo de UI en navegador real (el entorno de Chromium local se bloqueó). Ningún test simulado equivale a inferencia ONNX real. El benchmark Q4 sí fue ejecutado anteriormente por el usuario en su dispositivo y reportó 3 resultados discrepantes; esta versión no ha sido probada aún.
