# .bash_profile

# Get the aliases and functions
if [ -f ~/.bashrc ]; then
	. ~/.bashrc
fi

# User specific environment and startup programs

PATH=$PATH:$HOME/.local/bin:$HOME/bin
alias grep='grep --color=auto'
export PATH=~/.user/bin:${PATH}
export LD_LIBRARY_PATH=$LD_LIBRARY_PATH:~/.user/lib
source ${HOME}/.branch.sh
. "$HOME/.cargo/env"
