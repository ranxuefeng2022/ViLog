# .bashrc

# Source global definitions
if [ -f /etc/bashrc ]; then
	. /etc/bashrc
fi

# Uncomment the following line if you don't like systemctl's auto-paging feature:
# export SYSTEMD_PAGER=

# User specific aliases and functions
alias grep='grep --color=auto'
alias rg='rg --no-ignore-global'
export EDITOR="nvim"
export VISUAL="nvim"
shopt -s direxpand

bind '"\C-t": reverse-search-history'
source ~/.branch.sh
export PATH="$HOME/.local/bin:$PATH"
. "$HOME/.cargo/env"
export PATH="$HOME/.cargo/bin:$PATH"
export RIPGREP_CONFIG_PATH=~/.ripgreprc
export EXA_ICONS=1
export PATH="$HOME/.user/nvim-linux-x86_64/bin:$PATH"
export PATH="$HOME/.user/clangd_19.1.2/bin:$PATH"
export PATH="$HOME/.user/node-v24.0.1-linux-x64/bin:$PATH"
export PATH="/home/ranxuefeng/.user/node-v24.11.1-linux-x64/bin:$PATH"
export PATH=$HOME/.user/bin:$PATH
p() {
	python3 -c "for i in range(256): print(f'\x1b[48;5;{i}m {i:3} \x1b[0m', end='\n' if i % 41 == 40 else '')"
}
export _ZO_FFZF_PATH='~/.user/bin/fzf'
#export PATH=/home/ranxuefeng/.mypython/bin:$PATH
export TERM=xterm-256color
export LD_LIBRARY_PATH=/opt6/ranxuefeng/.my_libs:$LD_LIBRARY_PATH
export FZF_DEFAULT_OPTS='
  --border
  --color=dark
  --prompt="fzf快速搜索🔍>  "
  --info=inline
  --multi
  --color=info:#cba6f7,prompt:#89b4fa,pointer:#f5e0dc
  --color=fg+:#cdd6f4,bg+:#313244,hl+:#f38ba8
'
#source ~/.venv/bin/activate
eval "$(starship init bash)"
alias ls='exa'
alias y='yazi'
alias vim='nvim'
# 设置颜色方案
export EXA_COLORS="\
da=38;5;245:\
di=38;5;33:\
sn=38;5;28:\
sb=38;5;28:\
uu=38;5;40:\
gu=38;5;166:\
lc=38;5;240:"
#eval "$(zoxide init bash)"
export pyd="python download.py -n PD -f /images/"

tm() {
	tmux at -t 0
}

cl() {
	tmux send-keys -t 0 'clear' Enter
	tmux send-keys -t 1 'clear' Enter
	tmux send-keys -t 2 'clear' Enter
	tmux send-keys -t 3 'clear' Enter
}

cld() {
	tmux send-keys -t 0 'cd' Enter
	tmux send-keys -t 1 'cd' Enter
	tmux send-keys -t 2 'cd' Enter
	tmux send-keys -t 3 'cd' Enter
}

cls() {
	tmux send-keys -t 0 'source ~/.bashrc' Enter
	tmux send-keys -t 1 'source ~/.bashrc' Enter
	tmux send-keys -t 2 'source ~/.bashrc' Enter
	tmux send-keys -t 3 'source ~/.bashrc' Enter

	tmux send-keys -t 0 'clear' Enter
	tmux send-keys -t 1 'clear' Enter
	tmux send-keys -t 2 'clear' Enter
	tmux send-keys -t 3 'clear' Enter
}

tls() {
	tmux send-keys -t 0 'tmux source-file ~/.tmux.conf' Enter
	tmux send-keys -t 1 'tmux source-file ~/.tmux.conf' Enter
	tmux send-keys -t 2 'tmux source-file ~/.tmux.conf' Enter
	tmux send-keys -t 3 'tmux source-file ~/.tmux.conf' Enter
}

c() {
	cd ~/logc
}

ni() {
	nvim ~/.config/nvim/.init.vim
}

gb() {
	git rev-parse --abbrev-ref HEAD
}

f() {
    local dir
    # 使用 fd 列出目录，fzf 选择
    dir=$(fd -t d . 2>/dev/null | fzf) || return
    # 如果选择为空，直接返回
    [ -z "$dir" ] && return
    cd "$dir" || echo "无法切换到目录: $dir"
}

g() {
	fg
}

ff() {
	cd ~/logc
	cd $(fd -t d | fzf)
}

fcd() {
  # -1: 只取一个结果, -type d: 只查目录
  local dir
  dir=$(fd -t d . 2>/dev/null | fzf) || return
  cd "$dir" || echo "无法切换到目录: $dir"
}

gco() {
  git checkout $(git branch --all | fzf)
  git pull
}

fz() {
  local dir
  dir=$(zoxide query -l | fzf) || return
  cd "$dir" || echo "无法切换到目录: $dir"
}

fzv() {
  local dir
  dir=$(zoxide query -l | fzf) || return
  cd "$dir" || echo "无法切换到目录: $dir"
  nvim
}

n() {
	nvim -u ~/.vimrc_ex l
}

vs() {
	nvim -S ~/.vim/lastsession.vim Enter
}

u() {
	~/m/unzip.sh
}

alias vu='nvim -u ~/.vimrc'

push() {
	git push origin HEAD:refs/for/$(git rev-parse --abbrev-ref HEAD)
}

alias v='nvim'
alias bear='bear -a --libear /home/ranxuefeng/.local/lib/bear/libear.so'

export PATH="$HOME/.local/bin:$PATH"

user() {
	TARGET_BUILD_VARIANT=user ./vbuild
}

userdebug() {
	TARGET_BUILD_VARIANT=userdebug ./vbuild
}

eng() {
	TARGET_BUILD_VARIANT=eng ./vbuild
}

vp() {
	nvim vendor/vivo/pri-charge/common/
}

commit() {
	git commit -m $bu2426
}

gs() {
	git status
}

cv() {
	nvim ~/.vim/cvbuf.c
}
#pygmentize -f html -l c -o output.html app.c

eval "$(zoxide init bash)"
export PATH=/home/ranxuefeng/.user/node-v24.11.1-linux-x64/bin:$PATH
