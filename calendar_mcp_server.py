#!/usr/bin/env python3
"""
Servidor MCP para Google Calendar
Proporciona acceso al calendario mediante Model Context Protocol
"""

import asyncio
import json
from datetime import datetime, timedelta
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
import google_calendar

# Crear servidor MCP
app = Server("google-calendar-mcp")

@app.list_tools()
async def list_tools() -> list[Tool]:
    """Lista las herramientas disponibles del calendario"""
    return [
        Tool(
            name="ver_calendario",
            description="Consulta eventos del calendario de Google. Puede ver eventos de hoy o próximos eventos.",
            inputSchema={
                "type": "object",
                "properties": {
                    "periodo": {
                        "type": "string",
                        "description": "Periodo a consultar: 'hoy' para eventos del día actual, 'proximos' para próximos eventos",
                        "enum": ["hoy", "proximos"]
                    },
                    "max_results": {
                        "type": "number",
                        "description": "Número máximo de eventos a obtener (solo para 'proximos', por defecto 10)",
                        "default": 10
                    }
                },
                "required": ["periodo"]
            }
        ),
        Tool(
            name="crear_evento",
            description="Crea un nuevo evento en el calendario de Google. Requiere título y fecha/hora de inicio.",
            inputSchema={
                "type": "object",
                "properties": {
                    "titulo": {
                        "type": "string",
                        "description": "Título o resumen del evento"
                    },
                    "fecha_inicio": {
                        "type": "string",
                        "description": "Fecha y hora de inicio en formato ISO 8601 (ej: '2025-12-06T10:00:00')"
                    },
                    "fecha_fin": {
                        "type": "string",
                        "description": "Fecha y hora de fin (opcional, por defecto 1 hora después del inicio)"
                    },
                    "descripcion": {
                        "type": "string",
                        "description": "Descripción del evento (opcional)"
                    },
                    "ubicacion": {
                        "type": "string",
                        "description": "Ubicación del evento (opcional)"
                    }
                },
                "required": ["titulo", "fecha_inicio"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Ejecuta una herramienta del calendario"""
    
    if name == "ver_calendario":
        periodo = arguments.get("periodo", "proximos")
        
        if periodo == "hoy":
            result = google_calendar.get_today_events()
        else:
            max_results = arguments.get("max_results", 10)
            result = google_calendar.get_upcoming_events(max_results)
        
        return [TextContent(type="text", text=result)]
    
    elif name == "crear_evento":
        titulo = arguments["titulo"]
        fecha_inicio = arguments["fecha_inicio"]
        fecha_fin = arguments.get("fecha_fin")
        descripcion = arguments.get("descripcion")
        ubicacion = arguments.get("ubicacion")
        
        result = google_calendar.create_event(
            summary=titulo,
            start_datetime=fecha_inicio,
            end_datetime=fecha_fin,
            description=descripcion,
            location=ubicacion
        )
        
        return [TextContent(type="text", text=result)]
    
    else:
        raise ValueError(f"Herramienta desconocida: {name}")

async def main():
    """Ejecutar el servidor MCP"""
    async with stdio_server() as (read_stream, write_stream):
        await app.run(read_stream, write_stream, app.create_initialization_options())

if __name__ == "__main__":
    asyncio.run(main())
