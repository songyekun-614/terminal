# Keep the user's aliases, functions, prompt and startup behavior.
if [[ -r ~/.bashrc ]]; then
    source ~/.bashrc
fi

_mac_style_terminal_prompt() {
    local previous_status=$?
    local color='#28c840' line
    local pattern='"username_color"[[:space:]]*:[[:space:]]*"(#[[:xdigit:]]{6})"'
    if [[ -r ${MAC_STYLE_TERMINAL_SETTINGS:-} ]]; then
        while IFS= read -r line || [[ -n $line ]]; do
            if [[ $line =~ $pattern ]]; then
                color=${BASH_REMATCH[1]}
                break
            fi
        done < "$MAC_STYLE_TERMINAL_SETTINGS"
    fi

    # Other prompt hooks may replace PS1; recolor their latest version.
    if [[ ${PS1-} != "${_mac_style_terminal_rendered-}" ]]; then
        _mac_style_terminal_original=${PS1-}
    fi
    local original=${_mac_style_terminal_original-} result='' pair
    local saved_style='' escape_content=''
    local sgr_pattern='(\\e|\\033|\\x1[bB]|'$'\e'')\[[0-9;:]*m'
    local inside_escape=0 index
    local color_escape="\[\e[38;2;$((16#${color:1:2}));$((16#${color:3:2}));$((16#${color:5:2}))m\]"
    for ((index=0; index<${#original}; index++)); do
        pair=${original:index:2}
        case "$pair" in
            '\[') inside_escape=1; escape_content=''; result+=$pair; index=$((index + 1));;
            '\]')
                inside_escape=0; result+=$pair; index=$((index + 1))
                # Replay prior SGR state after colored names to keep other colors.
                while [[ $escape_content =~ $sgr_pattern ]]; do
                    saved_style+=${BASH_REMATCH[0]}
                    escape_content=${escape_content#*"${BASH_REMATCH[0]}"}
                done;;
            '\\') result+=$pair; escape_content+=$pair; index=$((index + 1));;
            '\u'|'\h'|'\H')
                # Leave OSC window titles and other nonprinting escapes intact.
                if ((inside_escape)); then result+=$pair; escape_content+=$pair
                else
                    # Color the usual user@host segment together, including @.
                    if [[ ${original:index:5} == '\u@\h' || ${original:index:5} == '\u@\H' ]]; then
                        pair=${original:index:5}
                        index=$((index + 3))
                    fi
                    result+="${color_escape}${pair}\[\e[39m${saved_style}\]"
                fi
                index=$((index + 1));;
            *)
                result+=${original:index:1}
                if ((inside_escape)); then escape_content+=${original:index:1}; fi;;
        esac
    done
    PS1=$result
    _mac_style_terminal_rendered=$result
    if [[ $- == *i* ]]; then
        printf '\033]666;vte.ext.macstyle.prompt-idle=1\033\\'
    fi
    return "$previous_status"
}

# PS0 runs before commands, including Bash builtins that keep the shell foreground.
printf -v _mac_style_terminal_preexec '\033]666;vte.ext.macstyle.prompt-idle=0\033\\'
PS0="${_mac_style_terminal_preexec}${PS0-}"

# Run after the user's existing prompt commands, preserving string and array forms.
if [[ $(declare -p PROMPT_COMMAND 2>/dev/null) == 'declare -a '* ]]; then
    PROMPT_COMMAND+=('_mac_style_terminal_prompt')
elif [[ -n ${PROMPT_COMMAND:-} ]]; then
    PROMPT_COMMAND=("$PROMPT_COMMAND" '_mac_style_terminal_prompt')
else
    PROMPT_COMMAND=('_mac_style_terminal_prompt')
fi
