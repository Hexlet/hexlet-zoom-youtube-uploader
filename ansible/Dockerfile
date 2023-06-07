FROM quay.io/ansible/ansible-runner:latest

RUN ln -s /usr/bin/python3 /usr/bin/python

RUN python -m pip install --upgrade pip
RUN pip install docker
RUN yum update -y && yum -yyq install cronie unzip vim

COPY requirements.yml /tmp/requirements.yml

RUN ansible-galaxy install -f -r /tmp/requirements.yml

# NOTE: ansible-runner entrypoint replace /etc/passwd & /etc/group
# creating users and groups has no effect
ENV CURRENT_UID=1
