export default async function handler(req, res) {
    // Solo permitimos peticiones POST
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método no permitido' });
    }

    const { imageBase64, mimeType } = req.body;
    
    // Aquí Vercel inyectará tu clave secreta
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'Falta la API Key en el servidor' });
    }

    const prompt = `Analiza esta captura de pantalla de un boleto de apuestas deportivas. Extrae la siguiente información y devuélvela ÚNICAMENTE en formato JSON válido, sin texto adicional y sin formato markdown (no uses \`\`\`json).
    Además, genera un campo "mensaje_ia" con un mensaje conversacional, directo y amable. Si lograste extraer todo bien, dile que todo está listo. Si falta algo, menciónalo educadamente.
    
    Estructura del JSON:
    {
      "equipo": "Nombre del equipo o selección",
      "cuota": "Número decimal (ejemplo: 1.85)",
      "mercado": "Tipo de apuesta (ejemplo: Ganador, Más de 2.5 goles)",
      "importe": "Cantidad apostada (ejemplo: 10.50)",
      "mensaje_ia": "Mensaje."
    }`;

    try {
        const payload = {
            contents: [{
                role: "user",
                parts: [
                    { text: prompt },
                    { inlineData: { mimeType: mimeType || "image/jpeg", data: imageBase64 } }
                ]
            }]
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const result = await response.json();
        
        if (!response.ok) {
            console.error("Error de Gemini:", result);
            return res.status(500).json({ error: 'Error comunicando con la IA' });
        }

        let responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) return res.status(500).json({ error: 'La IA no devolvió datos' });

        responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
        const datosExtraidos = JSON.parse(responseText);

        // Devolvemos los datos limpios a tu frontend
        return res.status(200).json(datosExtraidos);

    } catch (error) {
        console.error("Error en el servidor:", error);
        return res.status(500).json({ error: 'Error procesando la imagen' });
    }
}
