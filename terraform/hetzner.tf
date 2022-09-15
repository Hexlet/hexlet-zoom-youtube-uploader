resource "hcloud_ssh_key" "andrey_m" {
  name       = "andrey.m"
  public_key = file("../files/ssh_keys/andrey.m")
}

resource "hcloud_ssh_key" "andrey_g" {
  name       = "andrey.g"
  public_key = file("../files/ssh_keys/andrey.g")
}

resource "hcloud_ssh_key" "sergey_m" {
  name       = "sergey.m"
  public_key = file("../files/ssh_keys/sergey.m")
}

resource "hcloud_ssh_key" "kirill_m" {
  name       = "kirill.m"
  public_key = file("../files/ssh_keys/kirill.m")
}

resource "hcloud_ssh_key" "stanislav_d" {
  name       = "stanislav.d"
  public_key = file("../files/ssh_keys/stanislav.d")
}

resource "hcloud_ssh_key" "kirill_c" {
  name       = "kirill.c"
  public_key = file("../files/ssh_keys/kirill.c")
}

resource "hcloud_ssh_key" "sergei_m" {
  name       = "sergei.m"
  public_key = file("../files/ssh_keys/sergei.m")
}

resource "hcloud_server" "hexlet-zoom-youtube-uploader" {
  name        = "zoom-youtube-uploader"
  image       = "docker-ce"
  server_type = "cpx11"
  location    = "hel1"
  ssh_keys    = data.hcloud_ssh_keys.all_keys.ssh_keys.*.name
}

output "hexlet-zoom-youtube-uploader_ip_address" {
  value = hcloud_server.hexlet-zoom-youtube-uploader.ipv4_address
}
