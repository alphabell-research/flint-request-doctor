"""Compare request rules with pinned upstream Python validation, without loading MLX."""
import ast
import copy
import dataclasses
import json
import logging
import pathlib
import subprocess
import threading
import types
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
REC = 'https://raw.githubusercontent.com/recursive-oss/rec/8af99abaf50b33903147d89eed91d1bb3ac642dd/'
MLX = 'https://raw.githubusercontent.com/ml-explore/mlx-lm/ed1fca4cef15a824c5f1702c80f70b4cffc8e4dd/mlx_lm/server.py'


def source(url):
    with urllib.request.urlopen(url, timeout=30) as response:
        return ast.parse(response.read().decode())


def method(tree, name):
    return copy.deepcopy(next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == name))


def reference():
    upstream = source(MLX)
    server = source(REC + 'engine/src/rec_mlx/server.py')
    engine = source(REC + 'engine/src/rec_mlx/engine.py')
    base = ast.ClassDef(name='Base', bases=[], keywords=[], body=[method(upstream, '_validate'), method(upstream, 'validate_model_parameters')], decorator_list=[])
    handler = ast.ClassDef(name='Reference', bases=[ast.Name(id='Base', ctx=ast.Load())], keywords=[], body=[method(server, 'drop_unknown_fields'), method(server, 'validate_request')], decorator_list=[])
    sampling = copy.deepcopy(next(n for n in ast.walk(engine) if isinstance(n, ast.ClassDef) and n.name == 'Sampling'))
    module = ast.fix_missing_locations(ast.Module(body=[base, handler, sampling], type_ignores=[]))
    namespace = {'dataclass': dataclasses.dataclass, 'grammar_mode': 'flint', 'ignored_fields_lock': threading.Lock(), 'ignored_fields': set(), 'logging': logging}
    # Only the three reviewed validation classes are compiled. No imports, server,
    # model loader, kernels, prompt code or downloaded entry point is executed.
    exec(compile(module, '<pinned-upstream-validation>', 'exec'), namespace)
    allowed_node = next(n for n in ast.walk(method(server, 'drop_unknown_fields')) if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'allowed' for t in n.targets))
    return namespace['Reference'], namespace['Sampling'], ast.literal_eval(allowed_node.value)


def oracle(raw, ref, sampling, allowed):
    body = json.loads(raw)
    unknown = set(body) - allowed
    item = ref()
    item.body = copy.deepcopy(body)
    item.response_generator = types.SimpleNamespace(cli_args=types.SimpleNamespace(num_draft_tokens=0))
    values = dict(stream=False, stream_options=None, requested_model='default_model', requested_draft_model='default_model', num_draft_tokens=0, adapter=None, max_tokens=1024, temperature=1.0, top_p=.95, top_k=20, min_p=0.0, repetition_penalty=0.0, repetition_context_size=20, presence_penalty=0.0, presence_context_size=20, frequency_penalty=0.0, frequency_context_size=20, xtc_probability=0.0, xtc_threshold=0.0, logprobs=False, top_logprobs=-1, seed=None, logit_bias=None)
    for key in tuple(values):
        if key in body:
            values[key] = body[key]
    values['requested_model'] = body.get('model', 'default_model')
    values['max_tokens'] = body.get('max_completion_tokens')
    if values['max_tokens'] is None:
        values['max_tokens'] = body.get('max_tokens', 1024)
    for key, value in values.items():
        setattr(item, key, value)
    try:
        item.validate_request()
        explicit = body.get('max_completion_tokens')
        if explicit is None:
            explicit = body.get('max_tokens')
        effective = 8192 if explicit is None else min(item.max_tokens, 8192)
        sampling(temperature=item.temperature, top_p=item.top_p, top_k=item.top_k, presence_penalty=item.presence_penalty, max_tokens=effective, seed=0 if item.seed is None else item.seed)
        blocked = False
    except (ValueError, TypeError, KeyError):
        blocked = True
    return {'blocked': blocked, 'ignored': len(unknown)}


def vectors():
    base = {'model': 'flint', 'messages': [{'role': 'user', 'content': 'Hello'}], 'max_tokens': 256}
    rows = [('bounded', json.dumps(base))]
    values = {
        'model': ['flint', 'flint-int4', 'default_model', None, False],
        'messages': [[], None, {}, [None], [{}], [{'role': 'developer'}], [{'role': 'invalid'}]],
        'temperature': [-1, 0, .5, 2, 2.1, True, None, '1'],
        'top_p': [0, .1, 1, 1.1, False, None, '1'],
        'top_k': [-1, 0, 1, 1.0, 1.2, True, None],
        'presence_penalty': [-3, -2, 0, 2, 3, True, None],
        'frequency_penalty': [0, 0.0, False, 1, None, '0'],
        'min_p': [0, 0.0, False, .1, None, '0'],
        'repetition_penalty': [0, 1, 1.0, True, False, None, '1'],
        'store': [False, True, 0, None],
        'parallel_tool_calls': [True, False, 0, None, 'true'],
        'tool_choice': ['auto', 'none', 'required', None, {'type': 'function', 'function': {'name': 'x'}}],
        'grammar': ['flint', 'none', None, 'json'],
        'stream': [False, True, 0, None],
        'logprobs': [False, True, 0, None],
        'stream_options': [None, {}, {'include_usage': True}, {'include_usage': 1}, {'include_usage': 1.0}, {'include_usage': False}, {'include_usage': True, 'extra': 1}],
        'seed': [0, 1, -1, 1.0, True, None, '1', 9007199254740993, 18446744073709551616],
        'max_tokens': [0, 1, -1, 1.0, 15000.0, True, None, '256', 9007199254740993],
        'max_completion_tokens': [0, 1, -1, 1.0, True, None, '256'],
    }
    for field, options in values.items():
        for index, value in enumerate(options):
            rows.append((field + '-' + str(index), json.dumps({**base, field: value})))
    for grammar in ['flint', 'none']:
        for index, stop in enumerate([None, [], '', [''], [False], ['END'], 'END', 0, {}]):
            rows.append((grammar + '-stop-' + str(index), json.dumps({**base, 'grammar': grammar, 'stop': stop})))
    for field in ['response_format', 'reasoning_effort', 'thinking_token_budget', 'chat_template_kwargs', 'max_output_tokens', 'logit_bias', '__proto__']:
        rows.append(('ignored-' + field, json.dumps({**base, field: {'arbitrary': [1, 2]}})))
    for name, extra in [('precedence', {'max_tokens': -5, 'max_completion_tokens': 512}), ('stream-logprobs', {'stream': True, 'logprobs': True}), ('none-tools', {'tool_choice': 'none', 'tools': [{}]}), ('largest-seed-one-token', {'seed': 18446744073709551615, 'max_tokens': 1})]:
        rows.append((name, json.dumps({**base, **extra})))
    rows.append(('exponent-integer', '{"model":"flint","messages":[{"role":"user"}],"max_tokens":1e3}'))
    return rows


def main():
    logging.disable(logging.CRITICAL)
    ref, sampling, allowed = reference()
    rows = vectors()
    code = "import fs from 'node:fs';import {inspectRequest} from './rules.js';const rows=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(rows.map(raw=>{const r=inspectRequest(raw);return {blocked:r.blocked>0,ignored:r.ignored}})))"
    result = subprocess.run(['node', '--input-type=module', '-e', code], cwd=ROOT, input=json.dumps([raw for _, raw in rows]), text=True, check=True, capture_output=True)
    actual = json.loads(result.stdout)
    mismatches = []
    for (name, raw), measured in zip(rows, actual, strict=True):
        expected = oracle(raw, ref, sampling, allowed)
        if measured != expected:
            mismatches.append({'case': name, 'expected': expected, 'actual': measured})
    report = {'cases': len(rows), 'mismatches': mismatches, 'scope': 'Pinned request validation and Sampling with a synthetic remaining context of 8192. No model load, tokenizer, schema compiler, HTTP server or generation.'}
    print(json.dumps(report, indent=2))
    if mismatches:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
