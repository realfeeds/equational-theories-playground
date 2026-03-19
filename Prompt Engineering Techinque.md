* **Zero-Shot Prompting**

  * **When to Use:** Simple or common tasks where no examples are needed.
  * **Task Example:** Quick explanation or classification.
  * **Simple Example:** “Explain blockchain in simple terms.”

* **Few-Shot Prompting**

  * **When to Use:** When the model needs examples to learn the desired pattern or format.
  * **Task Example:** Formatting outputs or mimicking a style.
  * **Simple Example:**

    * Input: “Hello” → Output: “Greeting”
    * Input: “Bye” → Output: “Farewell”
    * Input: “Good morning” → ?

* **Chain-of-Thought (CoT)**

  * **When to Use:** Problems requiring reasoning or multi-step thinking.
  * **Task Example:** Math, logic puzzles, planning tasks.
  * **Simple Example:** “Solve this problem step by step.”

* **Self-Consistency**

  * **When to Use:** Complex reasoning where answers may vary and you want the most reliable result.
  * **Task Example:** Hard math or logic reasoning.
  * **Simple Example:** Generate multiple solutions and choose the most common answer.

* **Role Prompting**

  * **When to Use:** When domain expertise or perspective improves the output.
  * **Task Example:** Code review, legal explanation, architecture advice.
  * **Simple Example:** “You are a senior Python engineer. Review this code.”

* **Prompt Decomposition**

  * **When to Use:** Large or complicated tasks that need to be broken into smaller steps.
  * **Task Example:** Building an application from requirements.
  * **Simple Example:**

    * Step 1: Analyze requirements
    * Step 2: Design system architecture
    * Step 3: Generate code

* **Prompt Transformation / Generation**

  * **When to Use:** When converting data or documents into optimized prompts.
  * **Task Example:** Turning a product specification into a coding prompt.
  * **Simple Example:** Input: app specification → Output: prompt that instructs an AI to build the app.

* **Chain of Responsibility**

  * **When to Use:** When multiple agents or modules may handle different tasks.
  * **Task Example:** AI system routing requests to specialized agents.
  * **Simple Example:**

    * User request → Intent classifier
    * If coding → Coding agent
    * If design → UI agent

* **Structured Output Prompting**

  * **When to Use:** When output must follow a strict structure.
  * **Task Example:** API responses, data extraction.
  * **Simple Example:** “Return the result as JSON with fields: name, age, job.”

* **Constraint Prompting**

  * **When to Use:** When output needs limits or strict formatting.
  * **Task Example:** Summaries, controlled responses.
  * **Simple Example:** “Explain this in 3 bullet points under 50 words.”
