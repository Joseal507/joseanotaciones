import os
import base64
import json
import requests
import sys

# Lee un PDF y lo manda a Gemini 2.5 Flash vía OpenRouter
PDF_PATH = sys.argv[1] if len(sys.argv) > 1 else "test.pdf"
API_KEY = os.environ.get("OPENROUTER_API_KEY")

if not API_KEY:
    print("❌ Falta OPENROUTER_API_KEY")
    sys.exit(1)

with open(PDF_PATH, "rb") as f:
    pdf_b64 = base64.b64encode(f.read()).decode()

prompt = """Analiza este PDF página por página. Para cada página devuelve TODOS los bloques de texto que veas con sus coordenadas exactas.

Devuelve SOLO JSON válido con esta estructura:
{
  "pages": [
    {
      "page": 1,
      "width": 1000,
      "height": 1000,
      "blocks": [
        {
          "text": "texto literal exacto",
          "bbox": [ymin, xmin, ymax, xmax]
        }
      ]
    }
  ]
}

Coordenadas normalizadas 0-1000. NO inventes coords, solo las reales que veas."""

response = requests.post(
    "https://openrouter.ai/api/v1/chat/completions",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
    },
    json={
        "model": "google/gemini-2.5-flash",
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "file", "file": {"filename": "doc.pdf", "file_data": f"data:application/pdf;base64,{pdf_b64}"}},
            ],
        }],
    },
    timeout=120,
)

print(response.status_code)
print(response.text[:3000])
