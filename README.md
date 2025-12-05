# Cortex App - Interfaz de Voz con IA

Aplicación web para interactuar con IA mediante voz usando Whisper (STT) y TTS de OpenAI.

## Requisitos

- Node.js v18 o superior
- API Key de OpenAI

## Instalación

1. Instalar dependencias:
```bash
npm install
```

2. Configurar variables de entorno:
```bash
cp .env.example .env
```

3. Editar `.env` y agregar tu API Key de OpenAI:
```
OPENAI_API_KEY=tu_api_key_aqui
```

## Uso

Ejecutar el servidor:
```bash
npm start
```

O en modo desarrollo:
```bash
npm run dev
```

Abrir en el navegador: http://localhost:3000

## Funcionalidades

- Grabar audio pulsando el botón del micrófono
- Transcripción automática con Whisper
- Respuesta generada por GPT
- Reproducción de la respuesta con voz mediante TTS
