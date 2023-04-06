REMOTE=root@95.216.192.49

release: build deploy

build:
	rsync -a --exclude='node_modules' ./src/ ./dist
	# cd dist && NODE_ENV=production npm ci # При установке зависимостей локально и переносе на виртуалку ломается sqlite3

deploy:
	ssh -i ~/.ssh/id_rsa_hexlet $(REMOTE) 'cd /root/app'
	rsync -avz --progress -e 'ssh -i ~/.ssh/id_rsa_hexlet' ./dist/ $(REMOTE):/root/app

remote:
	ssh -i ~/.ssh/id_rsa_hexlet $(REMOTE)

dev:
	cd src && make dev

test:
	cd src && make test lint

getbd:
	rsync -avz --progress -e 'ssh -i ~/.ssh/id_rsa_hexlet' $(REMOTE):/root/data/database.db ./remote.db
