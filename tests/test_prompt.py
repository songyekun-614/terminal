import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

from mac_style_terminal.session import shell_command


class PromptTests(unittest.TestCase):
    def test_only_bash_uses_application_startup_file(self):
        self.assertEqual(shell_command('/bin/sh'), ['/bin/sh'])
        command = shell_command('/bin/bash')
        self.assertEqual(command[:2], ['/bin/bash', '--rcfile'])
        self.assertTrue(Path(command[2]).is_file())

    def test_username_changes_color_without_touching_title_or_running_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            path.write_text(json.dumps({'username_color': '#123456'}))
            startup = Path(__file__).resolve().parents[1] / 'mac_style_terminal/prompt.bash'
            script = r'''
source "$1"
PS1='\[\e]0;\u@\h: \w\a\]\u@\h:\w\$ '
_mac_style_terminal_prompt
printf '%s\n' "$PS1"
printf '%s\n' '{"username_color": "#aabbcc"}' > "$MAC_STYLE_TERMINAL_SETTINGS"
_mac_style_terminal_prompt
printf '%s\n' "$PS1"
_mac_style_terminal_prompt
printf '%s\n' "$PS1"
PS1='custom: \u> '
_mac_style_terminal_prompt
printf '%s\n' "$PS1"
'''
            result = subprocess.run(['/bin/bash', '--noprofile', '--norc', '-c', script, 'test', str(startup)],
                                    env={**os.environ, 'MAC_STYLE_TERMINAL_SETTINGS': str(path)},
                                    capture_output=True, text=True, check=True)
            lines = result.stdout.splitlines()
            self.assertEqual(lines[0], r'\[\e]0;\u@\h: \w\a\]\[\e[38;2;18;52;86m\]\u@\h\[\e[39m\]:\w\$ ')
            self.assertIn(r'\e[38;2;170;187;204m', lines[1])
            self.assertEqual(lines[1], lines[2])
            self.assertEqual(lines[3], r'custom: \[\e[38;2;170;187;204m\]\u\[\e[39m\]> ')

    def test_prompt_hooks_and_exit_status_are_preserved(self):
        startup = Path(__file__).resolve().parents[1] / 'mac_style_terminal/prompt.bash'
        for hook in ('PROMPT_COMMAND="printf existing"', 'PROMPT_COMMAND=("printf existing" "true")'):
            script = hook + r'''
source "$1"
PS1='\u> '
false
_mac_style_terminal_prompt
printf 'STATUS=%s\n' "$?"
printf 'HOOK=%s\n' "${PROMPT_COMMAND[@]}"
'''
            result = subprocess.run(['/bin/bash', '--noprofile', '--norc', '-c', script, 'test', str(startup)],
                                    capture_output=True, text=True, check=True)
            self.assertIn('STATUS=1', result.stdout)
            self.assertIn('HOOK=printf existing', result.stdout)
            self.assertEqual(result.stdout.count('HOOK=_mac_style_terminal_prompt'), 1)

    def test_shared_name_color_preserves_original_path_color(self):
        startup = Path(__file__).resolve().parents[1] / 'mac_style_terminal/prompt.bash'
        script = r'''
source "$1"
PS1='\[\033[01;32m\]\u@\h\[\033[0m\]:\[\e[34m\]\w\[\e[0m\]\$ '
_mac_style_terminal_prompt
printf '%s\n' "$PS1"
'''
        result = subprocess.run(['/bin/bash', '--noprofile', '--norc', '-c', script, 'test', str(startup)],
                                capture_output=True, text=True, check=True)
        self.assertIn(r'\[\e[38;2;40;200;64m\]\u@\h\[\e[39m\033[01;32m\]', result.stdout)
        self.assertIn(r':\[\e[34m\]\w\[\e[0m\]', result.stdout)

    def test_short_and_full_host_names_share_username_color_except_in_titles(self):
        startup = Path(__file__).resolve().parents[1] / 'mac_style_terminal/prompt.bash'
        script = r'''
source "$1"
PS1='\[\e]0;\u@\H\a\]\u / \h / \H: \w\$ '
_mac_style_terminal_prompt
printf '%s\n' "$PS1"
'''
        result = subprocess.run(['/bin/bash', '--noprofile', '--norc', '-c', script, 'test', str(startup)],
                                capture_output=True, text=True, check=True)
        self.assertTrue(result.stdout.startswith(r'\[\e]0;\u@\H\a\]'))
        for name in (r'\u', r'\h', r'\H'):
            self.assertIn(r'\[\e[38;2;40;200;64m\]' + name + r'\[\e[39m\]', result.stdout)
