import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import axios from 'axios';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AgentExecutor, createOpenAIFunctionsAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { z } from 'zod';

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

// Función para obtener coordenadas de una ciudad
async function getCityCoordinates(city) {
  try {
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es&format=json`;
    const response = await axios.get(geocodeUrl);
    
    if (response.data.results && response.data.results.length > 0) {
      const result = response.data.results[0];
      return {
        name: result.name,
        country: result.country,
        latitude: result.latitude,
        longitude: result.longitude
      };
    }
    return null;
  } catch (error) {
    console.error('Error en geocodificación:', error);
    return null;
  }
}

// Crear herramienta de clima usando LangChain
const weatherTool = new DynamicStructuredTool({
  name: 'obtener_clima',
  description: 'Obtiene el clima actual de una ciudad especificada. Usa esta herramienta cuando el usuario pregunte por el tiempo, clima, temperatura o condiciones meteorológicas de cualquier ciudad.',
  schema: z.object({
    city: z.string().describe('El nombre de la ciudad para consultar el clima')
  }),
  func: async ({ city }) => {
    try {
      console.log('📍 Consultando clima para:', city);
      
      // Obtener coordenadas
      const location = await getCityCoordinates(city);
      if (!location) {
        return `No se pudo encontrar la ciudad "${city}". Intenta con otra ciudad.`;
      }
      
      console.log('✓ Coordenadas encontradas:', location);
      
      // Obtener datos del clima
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto`;
      const weatherResponse = await axios.get(weatherUrl);
      
      const current = weatherResponse.data.current;
      
      // Interpretar el código del clima
      const weatherCodes = {
        0: 'Despejado',
        1: 'Mayormente despejado',
        2: 'Parcialmente nublado',
        3: 'Nublado',
        45: 'Con niebla',
        48: 'Niebla con escarcha',
        51: 'Llovizna ligera',
        53: 'Llovizna moderada',
        55: 'Llovizna densa',
        61: 'Lluvia ligera',
        63: 'Lluvia moderada',
        65: 'Lluvia intensa',
        71: 'Nevada ligera',
        73: 'Nevada moderada',
        75: 'Nevada intensa',
        80: 'Chubascos ligeros',
        81: 'Chubascos moderados',
        82: 'Chubascos violentos',
        95: 'Tormenta'
      };
      
      const weatherDescription = weatherCodes[current.weather_code] || 'Condiciones desconocidas';
      
      const climaInfo = `Clima en ${location.name}, ${location.country}:
- Temperatura: ${current.temperature_2m}°C
- Sensación térmica: ${current.apparent_temperature}°C
- Condiciones: ${weatherDescription}
- Humedad: ${current.relative_humidity_2m}%
- Viento: ${current.wind_speed_10m} km/h
- Precipitación: ${current.precipitation} mm`;
      
      console.log('✓ Clima obtenido');
      return climaInfo;
    } catch (error) {
      console.error('Error al obtener clima:', error);
      return `Lo siento, no pude obtener el clima para "${city}".`;
    }
  }
});

// Configurar LangChain con OpenAI
const llm = new ChatOpenAI({
  modelName: 'gpt-4',
  temperature: 0.7,
  openAIApiKey: process.env.OPENAI_API_KEY,
});

// Crear el prompt para el agente
const prompt = ChatPromptTemplate.fromMessages([
  ['system', `Eres Jarvis, el asistente de IA personal más avanzado. INSTRUCCIONES CRÍTICAS:

1. SIEMPRE debes dirigirte al usuario como "Jefe", "Boss", "Señor", "Patrón" o "Santi". Alterna entre estos términos de manera natural.
2. Debes responder SIEMPRE en español castellano, sin importar el idioma en que te hablen.
3. Sé profesional, eficiente y leal como un mayordomo británico de élite.
4. Responde de forma concisa pero completa.
5. Muestra respeto y deferencia, pero con un toque de calidez.
6. Cuando te pregunten por el clima o tiempo de una ciudad, DEBES usar la herramienta obtener_clima.
7. Al reportar el clima, hazlo de forma natural y conversacional.

Ejemplos de inicio: "Por supuesto, Jefe", "Entendido, Boss", "Como ordene, Señor", "Enseguida, Patrón", "A sus órdenes, Santi".`],
  ['human', '{input}'],
  new MessagesPlaceholder('agent_scratchpad'),
]);

// Crear el agente con herramientas
const agent = await createOpenAIFunctionsAgent({
  llm,
  tools: [weatherTool],
  prompt,
});

const agentExecutor = new AgentExecutor({
  agent,
  tools: [weatherTool],
  verbose: true,
});

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

// Endpoint para obtener respuesta de GPT con herramientas
app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'No se recibió mensaje' });
    }

    console.log('💬 Generando respuesta con GPT + Herramientas...');
    console.log('Mensaje del usuario:', message);

    // Primer llamada a GPT con herramientas
    const messages = [
      {
        role: 'system',
        content: `Eres Jarvis, el asistente de IA personal más avanzado. INSTRUCCIONES CRÍTICAS:

1. SIEMPRE debes dirigirte al usuario como "Jefe", "Boss", "Señor", "Patrón" o "Santi". Alterna entre estos términos de manera natural.
2. Debes responder SIEMPRE en español castellano, sin importar el idioma en que te hablen.
3. Sé profesional, eficiente y leal como un mayordomo británico de élite.
4. Responde de forma concisa pero completa.
5. Muestra respeto y deferencia, pero con un toque de calidez.
6. Cuando te pregunten por el clima o tiempo de una ciudad, DEBES usar la herramienta obtener_clima.
7. Al reportar el clima, hazlo de forma natural y conversacional.

Ejemplos de inicio: "Por supuesto, Jefe", "Entendido, Boss", "Como ordene, Señor", "Enseguida, Patrón", "A sus órdenes, Santi".`
      },
      {
        role: 'user',
        content: message
      }
    ];

    let response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages: messages,
      tools: tools,
      tool_choice: 'auto',
    });

    let responseMessage = response.choices[0].message;

    // Si GPT quiere usar una herramienta
    if (responseMessage.tool_calls) {
      console.log('🔧 GPT solicita usar herramienta:', responseMessage.tool_calls[0].function.name);
      
      // Agregar la respuesta de GPT a los mensajes
      messages.push(responseMessage);

      // Procesar cada llamada a herramienta
      for (const toolCall of responseMessage.tool_calls) {
        const functionName = toolCall.function.name;
        const functionArgs = JSON.parse(toolCall.function.arguments);

        console.log('Ejecutando función:', functionName, 'con args:', functionArgs);

        let functionResponse;
        if (functionName === 'obtener_clima') {
          functionResponse = await getWeather(functionArgs.city);
        }

        // Agregar el resultado de la herramienta a los mensajes
        messages.push({
          tool_call_id: toolCall.id,
          role: 'tool',
          name: functionName,
          content: functionResponse,
        });
      }

      // Segunda llamada a GPT con el resultado de la herramienta
      const secondResponse = await openai.chat.completions.create({
        model: 'gpt-4',
        messages: messages,
      });

      responseMessage = secondResponse.choices[0].message;
    }

    console.log('✓ Respuesta generada:', responseMessage.content);
    res.json({ response: responseMessage.content });

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
