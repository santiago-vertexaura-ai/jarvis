from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
from dotenv import load_dotenv
from openai import OpenAI
import requests
from urllib.parse import quote
import json
from pathlib import Path
import tempfile
import google_calendar

# Cargar variables de entorno
load_dotenv()

app = Flask(__name__, static_folder='public')
CORS(app)

# Configuración
PORT = int(os.getenv('PORT', 5000))
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Configurar OpenAI
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

# Función para obtener coordenadas de una ciudad
def get_city_coordinates(city):
    try:
        geocode_url = f"https://geocoding-api.open-meteo.com/v1/search?name={quote(city)}&count=1&language=es&format=json"
        response = requests.get(geocode_url)
        data = response.json()
        
        if data.get('results') and len(data['results']) > 0:
            result = data['results'][0]
            return {
                'name': result['name'],
                'country': result['country'],
                'latitude': result['latitude'],
                'longitude': result['longitude']
            }
        return None
    except Exception as e:
        print(f'Error en geocodificación: {e}')
        return None

# Función para obtener el clima de una ciudad
def get_weather(city):
    try:
        print(f'📍 Consultando clima para: {city}')
        
        # Obtener coordenadas
        location = get_city_coordinates(city)
        if not location:
            return f'No se pudo encontrar la ciudad "{city}". Intenta con otra ciudad.'
        
        print(f'✓ Coordenadas encontradas: {location}')
        
        # Obtener datos del clima
        weather_url = f"https://api.open-meteo.com/v1/forecast?latitude={location['latitude']}&longitude={location['longitude']}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m&timezone=auto"
        weather_response = requests.get(weather_url)
        weather_data = weather_response.json()
        
        current = weather_data['current']
        
        # Interpretar el código del clima
        weather_codes = {
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
        }
        
        weather_description = weather_codes.get(current['weather_code'], 'Condiciones desconocidas')
        
        clima_info = f"""Clima en {location['name']}, {location['country']}:
- Temperatura: {current['temperature_2m']}°C
- Sensación térmica: {current['apparent_temperature']}°C
- Condiciones: {weather_description}
- Humedad: {current['relative_humidity_2m']}%
- Viento: {current['wind_speed_10m']} km/h
- Precipitación: {current['precipitation']} mm"""
        
        print('✓ Clima obtenido')
        return clima_info
    except Exception as e:
        print(f'Error al obtener clima: {e}')
        return f'Lo siento, no pude obtener el clima para "{city}".'

# Definición de herramientas para OpenAI function calling
tools = [
    {
        'type': 'function',
        'function': {
            'name': 'obtener_clima',
            'description': 'Obtiene el clima actual de una ciudad especificada. Usa esta función cuando el usuario pregunte por el tiempo, clima, temperatura o condiciones meteorológicas de cualquier ciudad.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'city': {
                        'type': 'string',
                        'description': 'El nombre de la ciudad para consultar el clima (ej: "Madrid", "Barcelona", "Nueva York")'
                    }
                },
                'required': ['city']
            }
        }
    },
    {
        'type': 'function',
        'function': {
            'name': 'ver_calendario',
            'description': 'Consulta el calendario de Google del usuario para ver eventos, agenda, citas, reuniones o compromisos. Úsala cuando pregunten: "¿qué tengo hoy?", "¿cuáles son mis próximos eventos?", "¿tengo algo en mi agenda?", "¿qué reuniones tengo?", "muéstrame mi calendario", "¿qué eventos tengo programados?", etc.',
            'parameters': {
                'type': 'object',
                'properties': {
                    'periodo': {
                        'type': 'string',
                        'description': 'El periodo de tiempo a consultar: "hoy" para eventos del día actual, "proximos" para los próximos eventos futuros',
                        'enum': ['hoy', 'proximos']
                    },
                    'max_results': {
                        'type': 'integer',
                        'description': 'Número máximo de eventos a obtener (solo aplica para periodo "proximos", por defecto 10)',
                        'default': 10
                    }
                },
                'required': ['periodo']
            }
        }
    },
    {
        'type': 'function',
        'function': {
            'name': 'crear_evento',
            'description': 'Crea un nuevo evento en el calendario de Google. Úsala cuando el usuario pida crear, agendar, programar una reunión, cita o evento. Ejemplos: "crea una reunión mañana a las 10", "agenda una cita con el doctor", "programa una llamada".',
            'parameters': {
                'type': 'object',
                'properties': {
                    'titulo': {
                        'type': 'string',
                        'description': 'Título o resumen del evento'
                    },
                    'fecha_inicio': {
                        'type': 'string',
                        'description': 'Fecha y hora de inicio en formato ISO 8601 (ej: "2025-12-06T10:00:00")'
                    },
                    'fecha_fin': {
                        'type': 'string',
                        'description': 'Fecha y hora de fin en formato ISO 8601 (opcional, por defecto 1 hora después)'
                    },
                    'descripcion': {
                        'type': 'string',
                        'description': 'Descripción del evento (opcional)'
                    },
                    'ubicacion': {
                        'type': 'string',
                        'description': 'Ubicación del evento (opcional)'
                    }
                },
                'required': ['titulo', 'fecha_inicio']
            }
        }
    }
]

# Servir archivos estáticos
@app.route('/')
def index():
    return send_from_directory('public', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('public', path)

# Endpoint para transcribir audio con Whisper
@app.route('/api/transcribe', methods=['POST'])
def transcribe():
    try:
        if 'audio' not in request.files:
            return jsonify({'error': 'No se recibió archivo de audio'}), 400
        
        audio_file = request.files['audio']
        
        print('Transcribiendo audio con Whisper...')
        
        # Guardar temporalmente el archivo
        temp_path = os.path.join(UPLOAD_FOLDER, secure_filename(audio_file.filename or 'audio.webm'))
        audio_file.save(temp_path)
        
        # Transcribir con Whisper
        with open(temp_path, 'rb') as f:
            transcription = client.audio.transcriptions.create(
                model='whisper-1',
                file=f,
                language='es'
            )
        
        print(f'Transcripción: {transcription.text}')
        
        # Eliminar archivo temporal
        os.remove(temp_path)
        
        return jsonify({'text': transcription.text})
    
    except Exception as e:
        print(f'Error en transcripción: {e}')
        return jsonify({'error': 'Error al transcribir audio'}), 500

# Endpoint para obtener respuesta de GPT con función de clima
@app.route('/api/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        message = data.get('message')
        
        if not message:
            return jsonify({'error': 'No se recibió mensaje'}), 400
        
        print('💬 Generando respuesta con GPT + Function Calling...')
        print(f'Mensaje del usuario: {message}')
        
        # Detectar si necesita usar herramientas
        message_lower = message.lower()
        
        # Palabras clave para ver calendario
        calendar_keywords = ['evento', 'reunión', 'reuniones', 'agenda', 'calendario', 'cita', 'citas', 
                            'tengo hoy', 'tengo mañana', 'qué tengo', 'que tengo', 'próximo', 'proximo',
                            'programado', 'compromiso']
        
        # Palabras clave para crear eventos
        create_event_keywords = ['crea', 'crear', 'creó', 'creo', 'agenda', 'agendar', 'agendó', 
                                'programa', 'programar', 'programó', 'añade', 'añadir', 'añadió',
                                'agrega', 'agregar', 'agregó', 'nueva reunión', 'nuevo evento',
                                'nueva cita', 'pon', 'poner', 'apunta', 'apuntar']
        
        # Palabras clave para clima
        weather_keywords = ['clima', 'tiempo', 'temperatura', 'llueve', 'calor', 'frío', 'frio',
                           'pronóstico', 'pronostico', 'meteorológico']
        
        # Determinar si debe forzar el uso de herramientas
        force_create_event = any(keyword in message_lower for keyword in create_event_keywords)
        force_calendar = any(keyword in message_lower for keyword in calendar_keywords) and not force_create_event
        force_weather = any(keyword in message_lower for keyword in weather_keywords)
        
        # Crear el contexto de mensajes
        from datetime import datetime
        fecha_actual = datetime.now().strftime('%Y-%m-%d')
        hora_actual = datetime.now().strftime('%H:%M')
        
        messages = [
            {
                'role': 'system',
                'content': f"""Eres Jarvis, el asistente de IA personal de Santi. Tienes acceso COMPLETO a su calendario de Google y al clima mundial.

FECHA Y HORA ACTUAL: {fecha_actual} {hora_actual} (España)

INSTRUCCIONES CRÍTICAS:

1. SIEMPRE debes dirigirte al usuario como "Jefe", "Boss", "Señor", "Patrón" o "Santi".
2. Responde SIEMPRE en español castellano.
3. Sé profesional, eficiente y leal como un mayordomo británico de élite.

HERRAMIENTAS DISPONIBLES:
- obtener_clima: Para consultar el clima de cualquier ciudad
- ver_calendario: Para consultar el calendario de Google del usuario
- crear_evento: Para crear nuevos eventos en el calendario de Google

REGLAS OBLIGATORIAS:
- Si preguntan por clima/tiempo/temperatura → USA obtener_clima
- Si preguntan por eventos/reuniones/agenda/calendario/citas/qué tiene → USA ver_calendario
- Si piden crear/agendar/programar un evento/reunión/cita → USA crear_evento
- NUNCA respondas sobre el calendario sin usar las herramientas
- NUNCA digas que no tienes acceso o que vas a revisar - USA LAS HERRAMIENTAS DIRECTAMENTE
- Para crear eventos, DEBES formatear las fechas en ISO 8601 (YYYY-MM-DDTHH:MM:SS)
- IMPORTANTE: La fecha de HOY es {fecha_actual}. Úsala para calcular fechas como "hoy", "mañana", "pasado mañana"
- Si dicen "a las 4" asume que es 16:00 (4 PM) a menos que digan "de la mañana"

Ejemplos de inicio: "Por supuesto, Jefe", "Enseguida, Patrón", "A sus órdenes, Santi"."""
            },
            {
                'role': 'user',
                'content': message
            }
        ]
        
        # Determinar tool_choice basado en detección
        tool_choice = 'auto'
        if force_create_event:
            tool_choice = {'type': 'function', 'function': {'name': 'crear_evento'}}
            print('🎯 FORZANDO uso de crear_evento (se detectaron palabras clave de creación de evento)')
        elif force_calendar:
            tool_choice = {'type': 'function', 'function': {'name': 'ver_calendario'}}
            print('🎯 FORZANDO uso de ver_calendario (se detectaron palabras clave de calendario)')
        elif force_weather:
            tool_choice = {'type': 'function', 'function': {'name': 'obtener_clima'}}
            print('🎯 FORZANDO uso de obtener_clima (se detectaron palabras clave de clima)')
        
        print(f'Tool choice: {tool_choice}')
        
        # Primera llamada a GPT con herramientas disponibles
        response = client.chat.completions.create(
            model='gpt-4o-mini',
            messages=messages,
            tools=tools,
            tool_choice=tool_choice
        )
        
        response_message = response.choices[0].message
        
        # Si GPT decide usar una herramienta
        if response_message.tool_calls:
            print(f'🔧 GPT solicita usar herramienta: {response_message.tool_calls[0].function.name}')
            
            # Agregar la respuesta de GPT (con tool_calls) al historial
            messages.append(response_message)
            
            # Ejecutar cada herramienta solicitada
            for tool_call in response_message.tool_calls:
                function_name = tool_call.function.name
                function_args = json.loads(tool_call.function.arguments)
                
                print(f'Ejecutando función: {function_name} con argumentos: {function_args}')
                
                function_response = None
                if function_name == 'obtener_clima':
                    function_response = get_weather(function_args['city'])
                elif function_name == 'ver_calendario':
                    periodo = function_args.get('periodo', 'proximos')
                    if periodo == 'hoy':
                        function_response = google_calendar.get_today_events()
                    else:
                        max_results = function_args.get('max_results', 10)
                        function_response = google_calendar.get_upcoming_events(max_results)
                elif function_name == 'crear_evento':
                    titulo = function_args['titulo']
                    fecha_inicio = function_args['fecha_inicio']
                    fecha_fin = function_args.get('fecha_fin')
                    descripcion = function_args.get('descripcion')
                    ubicacion = function_args.get('ubicacion')
                    function_response = google_calendar.create_event(
                        summary=titulo,
                        start_datetime=fecha_inicio,
                        end_datetime=fecha_fin,
                        description=descripcion,
                        location=ubicacion
                    )
                
                # Agregar el resultado de la herramienta al historial
                messages.append({
                    'tool_call_id': tool_call.id,
                    'role': 'tool',
                    'name': function_name,
                    'content': function_response
                })
            
            # Segunda llamada a GPT con los resultados de las herramientas
            second_response = client.chat.completions.create(
                model='gpt-4o-mini',
                messages=messages
            )
            
            response_message = second_response.choices[0].message
        
        print(f'✓ Respuesta generada: {response_message.content}')
        return jsonify({'response': response_message.content})
    
    except Exception as e:
        print(f'Error en chat: {e}')
        return jsonify({'error': 'Error al generar respuesta'}), 500

# Endpoint para generar audio con TTS
@app.route('/api/speak', methods=['POST'])
def speak():
    try:
        data = request.get_json()
        text = data.get('text')
        
        if not text:
            return jsonify({'error': 'No se recibió texto'}), 400
        
        print('Generando audio con TTS...')
        preview_text = text[:100] + ('...' if len(text) > 100 else '')
        print(f'Texto a convertir: {preview_text}')
        
        # Generar audio con TTS
        response = client.audio.speech.create(
            model='tts-1',
            voice='nova',
            input=text,
            speed=1.0
        )
        
        # Crear archivo temporal para el audio
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.mp3')
        temp_file.write(response.content)
        temp_file.close()
        
        print(f'Audio generado, tamaño: {len(response.content)} bytes')
        print('✓ Audio TTS enviado correctamente')
        
        # Enviar el archivo y eliminarlo después
        try:
            return send_file(
                temp_file.name,
                mimetype='audio/mpeg',
                as_attachment=False,
                download_name='speech.mp3'
            )
        finally:
            # Programar eliminación del archivo temporal
            try:
                os.unlink(temp_file.name)
            except:
                pass
    
    except Exception as e:
        print(f'Error en TTS: {e}')
        return jsonify({'error': 'Error al generar audio'}), 500

if __name__ == '__main__':
    print(f'🎙️  Servidor Python corriendo en http://localhost:{PORT}')
    print('Presiona Ctrl+C para detener')
    app.run(host='0.0.0.0', port=PORT, debug=True)
