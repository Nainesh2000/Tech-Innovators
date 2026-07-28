import express from 'express';
import { GoogleGenAI } from '@google/genai';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const GEMINI_PANEL_SYSTEM_INSTRUCTION = `
You are an intelligent, empathetic technical interview panel powered by Gemini.

CRITICAL PROGRESSION & FEEDBACK PROTOCOL:
1. **EVALUATE PREVIOUS RESPONSE:**
   - Look closely at 'lastResponse'.
   - Provide direct feedback or constructive hints about their performance on that specific answer in the 'tip' field.

2. **PREVENT REPETITION:**
   - Check all past questions in conversation history. NEVER ask a question that was already asked.

3. **STAGE PROGRESSION:**
   - Turn 0 (Warm-up): Friendly greeting and casual icebreaker. NO heavy technical questions.
   - Turn 1 (Resume Check): Warmly acknowledge candidate, mention at least 2 specific highlights from their resume, and confirm their target role.
   - Turn 2+ (Technical Rounds): Advance to brand new technical, practical, or behavioral scenario questions suited for their role.

4. **DIRECT RESPONSES:**
   - If the candidate asked a clarification or spoke in another language, address their prompt DIRECTLY in 'question' before moving to the next question.

Return raw JSON ONLY matching this schema:
{
  "question": "Panel's spoken feedback on candidate's answer + the brand new question",
  "tip": "Constructive feedback or actionable tip on the candidate's last answer",
  "visualType": "none" | "image" | "code",
  "visualContent": "URL or code snippet string if relevant",
  "scores": { "content": 80, "communication": 85, "problemSolving": 80, "confidence": 85 },
  "detectedLanguage": "en-US",
  "isFinished": false,
  "finalScore": 0,
  "improvements": "Detailed actionable feedback provided when isFinished is true"
}
Do not wrap in markdown block formatting like \`\`\`json. Return raw valid JSON.
`;

app.post('/api/interview/next', async (req, res) => {
    try {
        const { name, role, resumeText, turnIndex, lastResponse, forceConclusion, history } = req.body;

        const contents = [];

        let backgroundContext = `CANDIDATE NAME: ${name}\nTARGET ROLE: ${role}\n`;
        if (resumeText && resumeText.trim().length > 0) {
            backgroundContext += `\nRESUME DETAILS:\n"""\n${resumeText}\n"""\n`;
        }

        contents.push({
            role: 'user',
            parts: [{ text: GEMINI_PANEL_SYSTEM_INSTRUCTION + "\n\nBACKGROUND CONTEXT:\n" + backgroundContext }]
        });

        // Sync Conversation Memory
        if (Array.isArray(history) && history.length > 0) {
            history.forEach(turn => {
                if (turn.userResponse) {
                    contents.push({ role: 'user', parts: [{ text: `Candidate Answer: "${turn.userResponse}"` }] });
                }
                if (turn.aiQuestion) {
                    contents.push({ role: 'model', parts: [{ text: JSON.stringify({ question: turn.aiQuestion }) }] });
                }
            });
        }

        // Handle Stage Specific Instructions
        if (forceConclusion) {
            contents.push({
                role: 'user',
                parts: [{ text: `The interview has concluded. Provide a final overall score out of 10 and actionable feedback in 'improvements'. Set 'isFinished': true.` }]
            });
        } else if (turnIndex === 0) {
            contents.push({
                role: 'user',
                parts: [{ text: `Turn 0: Greet ${name} warmly and casually. Ask a friendly icebreaker.` }]
            });
        } else if (turnIndex === 1) {
            contents.push({
                role: 'user',
                parts: [{ text: `Candidate said: "${lastResponse}"\n\nTurn 1: Acknowledge their response warmly. Cite AT LEAST 2 specific details from their resume and ask them to verify their goal for the ${role} position.` }]
            });
        } else {
            contents.push({
                role: 'user',
                parts: [{ text: `Candidate Answer: "${lastResponse}"\nCurrent Turn: ${turnIndex}\n\nDIRECTIVES:
1. Evaluate their answer and give brief feedback in 'tip'.
2. Formulate a BRAND NEW technical question suitable for a ${role}. Do NOT repeat past questions.` }]
            });
        }

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: contents
        });

        const jsonText = response.text.replace(/```json|```/g, '').trim();
        const parsedResponse = JSON.parse(jsonText);

        res.json(parsedResponse);
    } catch (error) {
        console.error("Gemini Server Error:", error);
        res.status(500).json({
            question: `Let's keep moving forward. Could you walk me through a complex technical problem you solved in your past projects?`,
            tip: "Structure your response with: Problem, Your Solution, and Outcome.",
            visualType: "none",
            visualContent: "",
            detectedLanguage: "en-US",
            scores: { content: 80, communication: 80, problemSolving: 80, confidence: 80 },
            isFinished: false
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Gemini Engine running on http://localhost:${PORT}`));