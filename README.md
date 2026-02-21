# 🚀 Quiz – Simulador Inteligente de Exámenes

Aplicación desarrollada en **Angular 21** para practicar bancos de preguntas de manera dinámica, tipo Kahoot.

Ideal para preparar certificaciones técnicas como **HCIP Datacom**, permitiendo práctica por bloques, control de tiempo y análisis de respuestas.

---

## 🎯 Características

- ✅ Banco de +500 preguntas
- ✅ Selección aleatoria sin repetición
- ✅ Rounds de 5 preguntas
- ✅ Temporizador regresivo por pregunta
- ✅ Resumen detallado por bloque
- ✅ Progreso global del examen
- ✅ Cache en localStorage para carga rápida
- 🔜 (Próximamente) Modo “solo preguntas falladas”

## 🎯 Tecnologías usadas
- Angular 21
- Standalone Components
- RxJS
- Zone.js (Change Detection)
- GitHub Pages (opcional para deploy)

## 🎯 Estructura Principal
src/
 ├── app/
 │    ├── core/
 │    │    └── services/
 │    │         └── quiz.service.ts
 │    ├── features/
 │    │    └── quiz/
 │    │         ├── quiz.component.ts
 │    │         ├── quiz.component.html
 │    │         └── quiz.component.scss
 ├── public/
 │    └── questions.json