export const PRESETS=[
 {id:'ignored',name:'A budget the server ignores',raw:`{
  "model": "flint",
  "messages": [{"role": "user", "content": "Use the available tool to look up Paris."}],
  "grammar": "flint",
  "max_tokens": 2048,
  "reasoning_effort": "low",
  "thinking_token_budget": 256,
  "response_format": {"type": "json_object"},
  "chat_template_kwargs": {"enable_thinking": false}
}`},
 {id:'integer',name:'15000.0 is not an integer',raw:`{
  "model": "flint",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 15000.0
}`},
 {id:'stops',name:'A stop string breaks the grammar',raw:`{
  "model": "flint",
  "messages": [{"role": "user", "content": "Hello"}],
  "grammar": "flint",
  "stop": ["END"],
  "max_tokens": 256
}`},
 {id:'precedence',name:'Which output limit wins?',raw:`{
  "model": "flint",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 256,
  "max_completion_tokens": 512
}`},
 {id:'tools',name:'A forced tool call',raw:`{
  "model": "flint",
  "messages": [{"role": "user", "content": "Hello"}],
  "tool_choice": "required",
  "parallel_tool_calls": false,
  "max_tokens": 256
}`},
 {id:'bounded',name:'A bounded starting request',raw:`{
  "model": "flint",
  "messages": [{"role": "user", "content": "Hello"}],
  "grammar": "flint",
  "max_tokens": 256,
  "temperature": 1.0,
  "top_p": 0.95,
  "top_k": 20,
  "stream": false
}`}
];
