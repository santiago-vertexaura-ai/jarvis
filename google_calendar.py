"""
Módulo para autenticación y acceso a Google Calendar API
"""
import os
import pickle
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from datetime import datetime, timedelta

# Scopes necesarios para Google Calendar (lectura y escritura)
SCOPES = ['https://www.googleapis.com/auth/calendar']

def get_calendar_service():
    """Obtiene el servicio de Google Calendar autenticado"""
    creds = None
    token_path = 'token.pickle'
    
    # Cargar token guardado si existe
    if os.path.exists(token_path):
        with open(token_path, 'rb') as token:
            creds = pickle.load(token)
    
    # Si no hay credenciales válidas, autenticar
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            print("\n🔐 Se requiere autenticación con Google Calendar")
            print("📋 Configurando autenticación...\n")
            
            # Crear credenciales desde variables de entorno
            client_config = {
                "installed": {
                    "client_id": os.getenv("GOOGLE_CLIENT_ID"),
                    "client_secret": os.getenv("GOOGLE_CLIENT_SECRET"),
                    "redirect_uris": ["http://localhost:8080/"],
                    "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                    "token_uri": "https://oauth2.googleapis.com/token",
                }
            }
            
            flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
            # Usar servidor local en puerto 8080
            creds = flow.run_local_server(
                host='localhost',
                port=8080,
                open_browser=True,
                success_message='✅ Autenticación completada. Puedes cerrar esta ventana.'
            )
            print("✅ Autenticación completada exitosamente\n")
        
        # Guardar credenciales para la próxima vez
        with open(token_path, 'wb') as token:
            pickle.dump(creds, token)
    
    return build('calendar', 'v3', credentials=creds)

def get_upcoming_events(max_results=10):
    """Obtiene los próximos eventos del calendario"""
    try:
        service = get_calendar_service()
        
        # Obtener eventos desde ahora
        now = datetime.utcnow().isoformat() + 'Z'
        
        events_result = service.events().list(
            calendarId='primary',
            timeMin=now,
            maxResults=max_results,
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        
        events = events_result.get('items', [])
        
        if not events:
            return "No tienes eventos próximos en tu calendario, Jefe."
        
        # Formatear eventos
        result = "📅 Tus próximos eventos:\n\n"
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            summary = event.get('summary', 'Sin título')
            
            # Parsear fecha
            try:
                if 'T' in start:
                    dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
                    fecha_str = dt.strftime('%d/%m/%Y %H:%M')
                else:
                    dt = datetime.fromisoformat(start)
                    fecha_str = dt.strftime('%d/%m/%Y') + ' (Todo el día)'
            except:
                fecha_str = start
            
            result += f"• {summary}\n  📍 {fecha_str}\n\n"
        
        return result
    
    except Exception as e:
        print(f"Error al obtener eventos del calendario: {e}")
        return f"Lo siento, Jefe. Hubo un error al acceder a su calendario: {str(e)}"

def get_today_events():
    """Obtiene los eventos de hoy"""
    try:
        service = get_calendar_service()
        
        # Inicio y fin del día de hoy
        now = datetime.now()
        start_of_day = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat() + 'Z'
        end_of_day = now.replace(hour=23, minute=59, second=59, microsecond=999999).isoformat() + 'Z'
        
        events_result = service.events().list(
            calendarId='primary',
            timeMin=start_of_day,
            timeMax=end_of_day,
            singleEvents=True,
            orderBy='startTime'
        ).execute()
        
        events = events_result.get('items', [])
        
        if not events:
            return "No tienes eventos programados para hoy, Jefe."
        
        result = f"📅 Eventos de hoy ({now.strftime('%d/%m/%Y')}):\n\n"
        for event in events:
            start = event['start'].get('dateTime', event['start'].get('date'))
            summary = event.get('summary', 'Sin título')
            
            try:
                if 'T' in start:
                    dt = datetime.fromisoformat(start.replace('Z', '+00:00'))
                    hora_str = dt.strftime('%H:%M')
                else:
                    hora_str = 'Todo el día'
            except:
                hora_str = start
            
            result += f"• {summary}\n  🕐 {hora_str}\n\n"
        
        return result
    
    except Exception as e:
        print(f"Error al obtener eventos de hoy: {e}")
        return f"Lo siento, Jefe. Hubo un error al acceder a su calendario: {str(e)}"

def create_event(summary, start_datetime, end_datetime=None, description=None, location=None):
    """
    Crea un nuevo evento en el calendario
    
    Args:
        summary: Título del evento
        start_datetime: Fecha/hora de inicio (formato ISO 8601 o datetime)
        end_datetime: Fecha/hora de fin (opcional, por defecto 1 hora después del inicio)
        description: Descripción del evento (opcional)
        location: Ubicación del evento (opcional)
    """
    try:
        service = get_calendar_service()
        
        # Convertir datetime a string si es necesario
        if isinstance(start_datetime, datetime):
            start_str = start_datetime.isoformat()
        else:
            start_str = start_datetime
            
        # Si no se proporciona hora de fin, usar 1 hora después del inicio
        if end_datetime is None:
            if isinstance(start_datetime, datetime):
                end_dt = start_datetime + timedelta(hours=1)
                end_str = end_dt.isoformat()
            else:
                # Parsear y añadir 1 hora
                start_dt = datetime.fromisoformat(start_str.replace('Z', '+00:00'))
                end_dt = start_dt + timedelta(hours=1)
                end_str = end_dt.isoformat()
        elif isinstance(end_datetime, datetime):
            end_str = end_datetime.isoformat()
        else:
            end_str = end_datetime
        
        # Crear el evento
        event = {
            'summary': summary,
            'start': {
                'dateTime': start_str,
                'timeZone': 'Europe/Madrid',
            },
            'end': {
                'dateTime': end_str,
                'timeZone': 'Europe/Madrid',
            }
        }
        
        # Añadir campos opcionales
        if description:
            event['description'] = description
        if location:
            event['location'] = location
        
        # Insertar el evento
        created_event = service.events().insert(calendarId='primary', body=event).execute()
        
        # Formatear respuesta
        event_link = created_event.get('htmlLink')
        start_time = datetime.fromisoformat(created_event['start']['dateTime'].replace('Z', '+00:00'))
        
        result = f"✅ Evento creado correctamente, Jefe:\n\n"
        result += f"📌 {summary}\n"
        result += f"🕐 {start_time.strftime('%d/%m/%Y a las %H:%M')}\n"
        if description:
            result += f"📝 {description}\n"
        if location:
            result += f"📍 {location}\n"
        result += f"\n🔗 Ver evento: {event_link}"
        
        return result
        
    except Exception as e:
        print(f"Error al crear evento: {e}")
        return f"Lo siento, Jefe. Hubo un error al crear el evento: {str(e)}"
