import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Configurar OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Configurar multer para subida de archivos
const upload = multer({ dest: 'uploads/' });

// Servir archivos estáticos
app.use(express.static('public'));
app.use(express.json());

// Endpoint para transcribir audio con Whisper
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió archivo de audio' });
    }

    console.log('Transcribiendo audio con Whisper...');

    // Transcribir con Whisper
    const transcription = await openai.audio.transcriptions.create({
      file: await fs.readFile(req.file.path).then(buffer => 
        new File([buffer], 'audio.webm', { type: 'audio/webm' })
      ),
      model: 'whisper-1',
      language: 'es',
    });

    console.log('Transcripción:', transcription.text);

    // Eliminar archivo temporal
    await fs.unlink(req.file.path);

    res.json({ text: transcription.text });
  } catch (error) {
    console.error('Error en transcripción:', error);
    res.status(500).json({ error: 'Error al transcribir audio' });
  }
});

// Endpoint para obtener respuesta de GPT
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'No se recibió mensaje' });
    }

    console.log('Generando respuesta con GPT...');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: [
        {
          role: 'system',
          content: 'Eres Jarvis, el asistente de IA personal más avanzado. INSTRUCCIONES CRÍTICAS:\n\n1. SIEMPRE debes dirigirte al usuario como "Jefe", "Boss", "Señor", "Patrón" o "Santi". Alterna entre estos términos de manera natural.\n2. Debes responder SIEMPRE en español castellano, sin importar el idioma en que te hablen.\n3. Sé profesional, eficiente y leal como un mayordomo británico de élite.\n4. Responde de forma concisa pero completa.\n5. Muestra respeto y deferencia, pero con un toque de calidez.\n\nEjemplos de inicio: "Por supuesto, Jefe", "Entendido, Boss", "Como ordene, Señor", "Enseguida, Patrón", "A sus órdenes, Santi".'
        },
        {
          role: 'user',
          content: message
        }
      ],
      temperature: 0.7,
      max_tokens: 500,
    });

    const responseText = completion.choices[0].message.content;
    console.log('Respuesta:', responseText);

    res.json({ response: responseText });
  } catch (error) {
    console.error('Error en chat:', error);
    res.status(500).json({ error: 'Error al generar respuesta' });
  }
});

// Endpoint para generar audio con TTS
app.post('/api/speak', async (req, res) => {
  try {
    const { text } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'No se recibió texto' });
    }

    console.log('Generando audio con TTS...');
    console.log('Texto a convertir:', text.substring(0, 100) + (text.length > 100 ? '...' : ''));

    const mp3 = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: text,
      speed: 1.0,
    });

    console.log('Audio generado, convirtiendo a buffer...');
    const buffer = Buffer.from(await mp3.arrayBuffer());
    console.log('Buffer creado, tamaño:', buffer.length, 'bytes');

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
      'Cache-Control': 'no-cache',
    });

    res.send(buffer);
    console.log('✓ Audio TTS enviado correctamente');
  } catch (error) {
    console.error('Error en TTS:', error);
    res.status(500).json({ error: 'Error al generar audio' });
  }
});

app.listen(PORT, () => {
  console.log(`🎙️  Servidor corriendo en http://localhost:${PORT}`);
  console.log('Presiona Ctrl+C para detener');
});
