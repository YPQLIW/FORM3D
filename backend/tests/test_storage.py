from __future__ import annotations

from conftest import make_form3d


def test_create_list_download_roundtrip(client):
    data = make_form3d("내 프로젝트", objects=3)
    r = client.post("/api/projects", content=data)
    assert r.status_code == 200, r.text
    meta = r.json()
    assert meta["name"] == "내 프로젝트" and meta["objects"] == 3 and meta["hasThumbnail"]
    assert meta["id"].startswith("p_")
    # 바이트 단위로 동일하게 돌아와야 함 (데이터 손실 없음)
    got = client.get(f"/api/projects/{meta['id']}/file")
    assert got.status_code == 200 and got.content == data
    lst = client.get("/api/projects").json()["projects"]
    assert [p["id"] for p in lst] == [meta["id"]]
    assert client.get(f"/api/projects/{meta['id']}/thumbnail").content.startswith(b"\x89PNG")


def test_save_keeps_previous_versions(client):
    v1 = make_form3d("A", objects=1)
    pid = client.post("/api/projects", content=v1).json()["id"]
    v2 = make_form3d("A", objects=2, scene=b"second")
    v3 = make_form3d("A", objects=3, scene=b"third")
    assert client.put(f"/api/projects/{pid}", content=v2).json()["objects"] == 2
    assert client.put(f"/api/projects/{pid}", content=v3).json()["objects"] == 3
    assert client.get(f"/api/projects/{pid}/file").content == v3
    versions = client.get(f"/api/projects/{pid}/versions").json()["versions"]
    assert len(versions) == 2
    # 가장 최근 백업 = v2, 그 전 = v1
    assert client.get(f"/api/projects/{pid}/versions/{versions[0]['id']}").content == v2
    assert client.get(f"/api/projects/{pid}/versions/{versions[1]['id']}").content == v1


def test_versions_are_pruned(client):
    client.app.state.store.versions_to_keep = 3
    pid = client.post("/api/projects", content=make_form3d()).json()["id"]
    for i in range(6):
        client.put(f"/api/projects/{pid}", content=make_form3d(scene=f"s{i}".encode()))
    assert len(client.get(f"/api/projects/{pid}/versions").json()["versions"]) == 3


def test_save_as_name_and_rename(client):
    pid = client.post("/api/projects?name=처음 이름", content=make_form3d("파일 안 이름")).json()["id"]
    assert client.get(f"/api/projects/{pid}").json()["name"] == "처음 이름"
    r = client.patch(f"/api/projects/{pid}", json={"name": "  바꾼 이름  "})
    assert r.status_code == 200 and r.json()["name"] == "바꾼 이름"
    assert client.patch(f"/api/projects/{pid}", json={"name": ""}).status_code == 422
    # 저장할 때 name 을 주면 이름도 갱신
    assert client.put(f"/api/projects/{pid}?name=저장 이름", content=make_form3d()).json()["name"] == "저장 이름"


def test_rejects_bad_files_and_keeps_old_data(client):
    good = make_form3d()
    pid = client.post("/api/projects", content=good).json()["id"]
    cases = [
        (b"not a zip at all", "invalid_file"),
        (good[:200], "corrupt_file"),
        (make_form3d(fmt="other"), "invalid_file"),
        (make_form3d(version=99), "newer_version"),
    ]
    for data, code in cases:
        r = client.put(f"/api/projects/{pid}", content=data)
        assert r.status_code == 400, (code, r.text)
        assert r.json()["detail"]["code"] == code
    # 잘못된 파일로 덮어쓰기 시도 후에도 원본은 그대로
    assert client.get(f"/api/projects/{pid}/file").content == good
    assert client.get(f"/api/projects/{pid}/versions").json()["versions"] == []


def test_unknown_and_malicious_ids(client):
    assert client.get("/api/projects/p_0000000000000000/file").status_code == 404
    assert client.get("/api/projects/..%2F..%2Fsecret/file").status_code == 404
    pid = client.post("/api/projects", content=make_form3d()).json()["id"]
    assert client.get(f"/api/projects/{pid}/versions/..%2Fproject").status_code == 404


def test_upload_size_limit(client):
    client.app.state.settings.max_upload_mb = 0
    r = client.post("/api/projects", content=make_form3d())
    assert r.status_code == 413


def test_atomic_write_leaves_no_temp_files(client, settings):
    pid = client.post("/api/projects", content=make_form3d()).json()["id"]
    client.put(f"/api/projects/{pid}", content=make_form3d(scene=b"x"))
    leftovers = list((settings.data_dir / "projects").rglob("*.tmp"))
    assert leftovers == []


def test_data_survives_restart(settings, fake_ai):
    from fastapi.testclient import TestClient
    from app.main import create_app

    data = make_form3d("재시작")
    app = create_app(settings, ai=fake_ai)
    with TestClient(app) as c:
        pid = c.post("/api/projects", content=data).json()["id"]
    app.state.store.close()
    app2 = create_app(settings, ai=fake_ai)
    with TestClient(app2) as c:
        assert c.get("/api/projects").json()["projects"][0]["name"] == "재시작"
        assert c.get(f"/api/projects/{pid}/file").content == data
    app2.state.store.close()
