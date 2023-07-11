REMOTE=root@95.216.192.49

local-ansible-build-image:
	docker build -t uploader-ansible ansible

ansible-vault-edit:
	docker run --rm \
	  -v $(CURDIR):/project \
	  -it \
	  -w /project \
	  uploader-ansible ansible-vault edit --vault-password-file tmp/vault_password ansible/group_vars/all/vault.yml

run-playbook:
	docker run --rm -it \
		-v $(SSH_AUTH_SOCK):/ssh-agent \
		--env SSH_AUTH_SOCK=/ssh-agent \
		-v $(CURDIR):/project \
		-w /project \
		uploader-ansible ansible-playbook ansible/${P}.yml -i ansible/inventory \
		--vault-password-file tmp/vault_password -vv --tags=$(T)

setup-datadog:
	make run-playbook P=instance T=datadog

release: build deploy

build:
	rsync -a --exclude='node_modules' --exclude='__tests__' ./src/ ./dist
	# cd dist && NODE_ENV=production npm ci # При установке зависимостей локально и переносе на виртуалку ломается sqlite3

deploy:
	rsync -avz --progress -e 'ssh -i ~/.ssh/id_rsa_hexlet' ./dist/ $(REMOTE):/root/app

remote:
	ssh -i ~/.ssh/id_rsa_hexlet $(REMOTE)

dev:
	cd src && make dev

test:
	cd src && make test lint

getdb:
	rsync -avz --progress -e 'ssh -i ~/.ssh/id_rsa_hexlet' $(REMOTE):/root/data/database.db ./remote.db
