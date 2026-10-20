# VOX Speak 3.0 · laboratorio fonético ONNX (AISLADO)

Prueba real de reconocimiento IPA local en Chrome Android. Es una **copia experimental** de los tres archivos aprobados y no cambia `vox-speak-v3-staging/main` ni `vox-speak-free`.

## Uso

1. Abrir en Chrome Android mediante URL HTTPS de GitHub Pages.
2. Elegir una frase corta y pulsar «Grabar mi voz» (máx. 10 s).
3. Pulsar «Detener grabación», reproducir el audio si se desea.
4. Pulsar «Analizar fonemas con IA local». Solo entonces se descarga Transformers.js y el modelo `onnx-community/wav2vec2-ljspeech-gruut-ONNX` (Q4 ~89,8 MB, más archivos auxiliares).
5. Esperar dejando la pantalla activa. Si funciona, aparecerá IPA bruto y los tiempos de carga e inferencia.
6. «Copiar resultados» permite pegar la secuencia reconocida y las métricas. No copia audio.

Sin Azure, sin claves, sin servidor, sin puntuaciones inventadas. Se usa un worker ES Module. Modelo ONNX Apache-2.0 alojado en Hugging Face. Se cargan dependencias de `cdn.jsdelivr.net` y `huggingface.co` bajo demanda.

## Límites

- No hay análisis fonético validado todavía: una predicción IPA no demuestra automáticamente corrección de pronunciación.
- La inferencia ONNX real **no ha sido probada en Android** antes del primer uso.
- La primera descarga puede consumir ~100 MB y llevar minutos; usa Wi-Fi. Cuota y caché varían por navegador.
- La prueba HTTPS es pública: no subas datos privados como grabaciones identificables si no deseas compartirlas. Los archivos de voz se mantienen localmente en el navegador; no se envían a nuestro repositorio ni a Azure.
- Se necesitan Chrome actualizado y conectividad para descargar el modelo al menos una vez.

## Cómo ejecutar tests

```
python3 -m http.server 8765
node --test tests/*.test.mjs
python tests/browser_smoke.py
```


## Corrección CTC v0.2 (error model-failed / Could not locate file)

El repositorio de Hugging Face proporciona `vocab.json` y `onnx/model_q4.onnx`, pero no `tokenizer.json`. La antigua carga con `pipeline('automatic-speech-recognition')` puede solicitar ese archivo y fallar antes de cargar ONNX. Para evitarlo, ahora se usan `AutoFeatureExtractor.from_pretrained` y `AutoModelForCTC.from_pretrained` directamente, y un decodificador CTC greedy con el vocabulario IPA exacto (IDs 0-42 + especiales 43/44).

La URL lleva un identificador de versión en los módulos del laboratorio para evitar reutilizar scripts antiguos cacheados. No cambia ningún archivo de producción ni staging. El comportamiento ONNX con el dispositivo Android aún debe validarse mediante la prueba real.

Evidencia local: `node --test tests/*.test.mjs` (22/22 aprobadas), incluidas pruebas simuladas del worker y decodificador. Estas pruebas **no** descargan los 90 MB del modelo real ni validan su latencia.

Si falla de nuevo, el texto ahora muestra el paso exacto (`loading-feature-extractor` o `loading-onnx-model`), útil para localizar un fallo de red/CORS o memoria diferente.
